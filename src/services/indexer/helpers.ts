import {Address, Slice} from "@ton/core";
import {BANNED_ASSETS_FROM, BANNED_ASSETS_TO, MIN_WORTH_SWAP_LIMIT} from "../../config";
import {Evaa, ExtendedAssetsConfig, PoolConfig} from "@evaafi/sdk";
import {Cell, Dictionary, OpenedContract} from "@ton/ton";
import {sleep} from "../../util/process";
import {formatBalances, getAddressFriendly, getFriendlyAmount} from "../../util/format";
import {Task} from "../../db/types";
import {LiquidationAssetsInfo} from "./types";
import {WalletBalances} from "../../lib/balances";
import {unpackPrices} from "../../util/prices";

export function makeGetAccountTransactionsRequest(address: Address, before_lt: number) {
    if (before_lt === 0)
        return `v2/blockchain/accounts/${address.toRawString()}/transactions?limit=1000`
    else
        return `v2/blockchain/accounts/${address.toRawString()}/transactions?before_lt=${before_lt}&limit=1000`
}

export function isBannedSwapFrom(assetID: bigint): boolean {
    return BANNED_ASSETS_FROM.findIndex(value => value === assetID) >= 0;
}

export function isBannedSwapTo(assetID: bigint): boolean {
    return BANNED_ASSETS_TO.findIndex(value => value === assetID) >= 0;
}

/**
 * @param assetIdFrom asset to exchange from (database specific asset id)
 * @param assetAmount amount of assets in its wei
 * @param assetIdTo asset to exchange to (database specific asset id)
 * @param extAssetsConfig assets config dictionary
 * @param prices prices dictionary
 */
export async function checkEligibleSwapTask(
    assetIdFrom: bigint, assetAmount: bigint, assetIdTo: bigint,
    extAssetsConfig: ExtendedAssetsConfig, prices: Dictionary<bigint, bigint>,
    poolConfig: PoolConfig
): Promise<boolean> {
    if (prices === undefined) {
        console.error(`Failed to obtain prices from middleware!`);
        return false;
    }

    const assetFrom = poolConfig.poolAssetsConfig.find(asset => (asset.assetId === assetIdFrom));
    const assetTo = poolConfig.poolAssetsConfig.find(asset => (asset.assetId === assetIdTo));
    const assetFromConfig = extAssetsConfig.get(assetIdFrom);

    if (!assetFrom) {
        console.error("Unsupported asset id: ", assetIdFrom);
        return false;
    }

    if (!assetFromConfig) {
        console.error('No config for asset id: ', assetIdFrom);
        return false;
    }
    if (!assetTo) {
        console.error("Unsupported asset id: ", assetIdTo);
        return false;
    }

    if (isBannedSwapFrom(assetIdFrom)) {
        console.error(`Cant swap ${assetFrom.name} asset!`);
        return false;
    }

    if (isBannedSwapTo(assetIdTo)) {
        console.error(`Cant swap to ${assetTo.name} asset!`);
        return false;
    }

    const assetPrice = prices.get(assetIdFrom);
    if (assetPrice === undefined) {
        console.error(`No price for asset ${assetFrom.name}`);
        return false;
    }

    const assetFromScale = 10n ** assetFromConfig.decimals;
    const assetWorth = assetAmount * assetPrice / assetFromScale; // norm_price * PRICE_ACCURACY( == 10**9)

    return assetWorth > MIN_WORTH_SWAP_LIMIT;
}

const ERROR_DESCRIPTIONS = new Map<number, string>([
    [0x30F1, "Master liquidating too much"],
    [0x31F2, "Not liquidatable"],
    [0x31F3, "Min collateral not satisfied"],
    [0x31F4, "User not enough collateral"],
    [0x31F5, "User liquidating too much"],
    [0x31F6, "Master not enough liquidity"],
    [0x31F7, "Liquidation prices missing"],
    [0x31F0, "User withdraw in process"]]
)

export const ERROR_CODE = {
    MASTER_LIQUIDATING_TOO_MUCH: 0x30F1,
    NOT_LIQUIDATABLE: 0x31F2,
    MIN_COLLATERAL_NOT_SATISFIED: 0x31F3,
    USER_NOT_ENOUGH_COLLATERAL: 0x31F4,
    USER_LIQUIDATING_TOO_MUCH: 0x31F5,
    MASTER_NOT_ENOUGH_LIQUIDITY: 0x31F6,
    LIQUIDATION_PRICES_MISSING: 0x31F7,
    USER_WITHDRAW_IN_PROCESS: 0x31F0,
}

export const OP_CODE = {
    MASTER_SUPPLY: 0x1,
    MASTER_WITHDRAW: 0x2,
    MASTER_LIQUIDATE: 0x3,
    JETTON_TRANSFER_NOTIFICATION: 0x7362d09c,
    JETTON_TRANSFER_INTERNAL: 0x7362d09c,
    DEBUG_PRINCIPALS: 0xd2,
    MASTER_SUPPLY_SUCCESS: 0x11a,
    MASTER_WITHDRAW_COLLATERALIZED: 0x211,
    USER_WITHDRAW_SUCCESS: 0x211a,
    MASTER_LIQUIDATE_SATISFIED: 0x311,
    USER_LIQUIDATE_SUCCESS: 0x311a,
    MASTER_LIQUIDATE_UNSATISFIED: 0x31f,
}

export function getErrorDescription(errorId: number): string {
    return ERROR_DESCRIPTIONS.get(errorId) ?? 'Unknown error';
}

export class DelayedCallDispatcher {
    lastCallTimestamp: number = 0;
    delay: number;

    constructor(delay: number) {
        this.delay = delay;
    }

    async makeCall<T>(func: () => Promise<T>): Promise<T> {
        const timeElapsed = Date.now() - this.lastCallTimestamp;
        const waitTimeLeft = this.delay - timeElapsed;
        const toSleep = waitTimeLeft > 0 ? waitTimeLeft : 0;
        this.lastCallTimestamp = toSleep + Date.now();

        console.log(`DelayedCallDispatcher: will sleep ${toSleep}ms more`);
        await sleep(toSleep);

        return await func();
    }
}

export function formatLiquidationSuccess(
    task: Task, assetsInfo: LiquidationAssetsInfo,
    loanAmount: bigint, protocolGift: bigint, collateralRewardAmount: bigint,
    txHash: string, txTime: Date, masterAddress: Address,
    myBalance: WalletBalances,
    assetsConfig: ExtendedAssetsConfig,
    prices: Dictionary<bigint, bigint>) {

    const {
        loanAssetName, loanAssetDecimals,
        collateralAssetName, collateralAssetDecimals
    } = assetsInfo;

    const {
        query_id: queryID,
        wallet_address: walletAddress,
        contract_address: contractAddress,
        loan_asset: loanId,
        collateral_asset: collateralId,
    } = task;

    const loanScale = 10n ** loanAssetDecimals;
    const collateralScale = 10n ** collateralAssetDecimals;
    const loanPrice = prices.get(loanId)!
    const collateralPrice = prices.get(collateralId)!;
    const transferredLoan = loanAmount + protocolGift;
    const transferredValue = transferredLoan * loanPrice / loanScale;
    const receivedValue = collateralRewardAmount * collateralPrice / collateralScale;
    const profit = receivedValue - transferredValue;
    const profitMargin = (Number(profit * 100n) / Number(transferredValue)).toFixed(2);

    return `✅ Liquidation task (Query ID: ${queryID}) successfully completed
<b>Evaa master address: </b> ${getAddressFriendly(masterAddress)}
<b>Loan asset:</b> ${loanAssetName}
<b>Loan amount:</b> ${getFriendlyAmount(loanAmount, loanAssetDecimals, loanAssetName)}
<b>Protocol gift: </b> ${getFriendlyAmount(protocolGift, loanAssetDecimals, loanAssetName)}
<b>Collateral asset:</b> ${collateralAssetName}
<b>Collateral amount:</b> ${getFriendlyAmount(collateralRewardAmount, collateralAssetDecimals, collateralAssetName)}
<b>Transferred value: </b> ${getFriendlyAmount(transferredValue, 9n, 'USD')} 
<b>Earned: </b> ${getFriendlyAmount(profit, 9n, 'USD')}
<b>Profit margin: </b> ${profitMargin}%

<b>User address:</b> <code>${getAddressFriendly(Address.parse(walletAddress))}</code>
<b>Contract address:</b> <code>${getAddressFriendly(Address.parse(contractAddress))}</code>
<b>Hash</b>: <code>${txHash}</code>
<b>Time:</b> ${txTime.toLocaleString('en-US', {timeZone: 'UTC'})} UTC

<b>My balance:</b>
${formatBalances(myBalance, assetsConfig)}`;
}

export function formatLiquidationUnsatisfied(task: Task,
                                             transferedAssetName: string, transferedAssetDecimals: bigint,
                                             collateralAssetName: string, collateralAssetDecimals: bigint,
                                             loanAmount: bigint, masterAddress: Address,
                                             liquidatorAddress: Address) {

    const {min_collateral_amount, wallet_address} = task;

    return `
<b>Evaa master address: </b> ${getAddressFriendly(masterAddress)}

User address: ${getAddressFriendly(Address.parse(wallet_address))}
Liquidator address: ${getAddressFriendly(liquidatorAddress)}
assetID: ${transferedAssetName}
transferred amount: ${getFriendlyAmount(loanAmount, transferedAssetDecimals, transferedAssetName)}
collateralAssetID: ${collateralAssetName}
minCollateralAmount: ${getFriendlyAmount(min_collateral_amount, collateralAssetDecimals, collateralAssetName)}\n`
}

export function formatSwapAssignedMessage(loanAssetName: string, collateralAssetName: string, collateralRewardAmount: bigint, collateralAssetDecimals: bigint) {
    return `<b>Assigned swap task</b> for exchanging of ${getFriendlyAmount(collateralRewardAmount, collateralAssetDecimals, collateralAssetName)} for ${loanAssetName}`;
}

export function formatSwapCanceledMessage(loanAssetName: string, collateralAssetName: string, collateralRewardAmount: bigint, collateralAssetDecimals: bigint) {
    return `Swap cancelled (${getFriendlyAmount(collateralRewardAmount, collateralAssetDecimals, collateralAssetName)} -> ${loanAssetName})`
}

export function getAssetsInfo(loanAsset: bigint, collateralAsset: bigint, evaa: OpenedContract<Evaa>) {
    const loanAssetPoolConfig = evaa.poolConfig.poolAssetsConfig.find(it => it.assetId === loanAsset);
    const collateralAssetPoolConfig = evaa.poolConfig.poolAssetsConfig.find(it => it.assetId === collateralAsset);
    if (!loanAssetPoolConfig) throw (`Asset ${loanAsset} is not supported`);
    if (!collateralAssetPoolConfig) throw (`Asset ${collateralAsset} is not supported`);

    const loanAssetExtConfig = evaa.data.assetsConfig.get(loanAsset);
    const collateralAssetExtConfig = evaa.data.assetsConfig.get(collateralAsset);
    if (!loanAssetExtConfig) throw (`No data for asset ${loanAsset}`);
    if (!collateralAssetExtConfig) throw (`No data for asset ${collateralAsset}`);

    const loanAssetName = loanAssetPoolConfig.name;
    const loanAssetDecimals = loanAssetExtConfig.decimals;
    const collateralAssetName = collateralAssetPoolConfig.name;
    const collateralAssetDecimals = collateralAssetExtConfig.decimals;
    return {
        loanAssetName, loanAssetDecimals, collateralAssetName, collateralAssetDecimals
    }
}

type ParsedSatisfiedTx = {
    deltaLoanPrincipal: bigint,
    liquidatableAmount: bigint,
    protocolGift: bigint,
    newLoanPrincipal: bigint,
    collateralAssetId: bigint,
    deltaCollateralPrincipal: bigint,
    collateralRewardAmount: bigint,
    minCollateralAmount: bigint,
    newCollateralPrincipal: bigint,
    forwardTonAmount: bigint,
}

export function parseSatisfiedTxMsg(satisfiedTx: Slice): ParsedSatisfiedTx {
    const extra = satisfiedTx.loadRef().beginParse();
    const deltaLoanPrincipal = extra.loadUintBig(64); // delta loan principal
    const liquidatableAmount = extra.loadUintBig(64); // loan amount
    const protocolGift = extra.loadUintBig(64); // protocol gift
    const newLoanPrincipal = extra.loadUintBig(64); // user new loan principal
    const collateralAssetId = extra.loadUintBig(256); // collateral asset id
    const deltaCollateralPrincipal = extra.loadUintBig(64); // delta collateral principal amount
    const collateralRewardAmount = extra.loadUintBig(64); // collateral reward for liquidation
    const minCollateralAmount = extra.loadUintBig(64);
    const newCollateralPrincipal = extra.loadUintBig(64);
    const forwardTonAmount = extra.loadUintBig(64);
    // const customResponsePayload: Cell = extra.loadMaybeRef();

    return {
        deltaLoanPrincipal,
        liquidatableAmount,
        protocolGift,
        newLoanPrincipal,
        collateralAssetId,
        deltaCollateralPrincipal,
        collateralRewardAmount,
        minCollateralAmount,
        newCollateralPrincipal,
        forwardTonAmount,
    }
}
