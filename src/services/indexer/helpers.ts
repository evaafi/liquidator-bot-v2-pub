import {Address, Slice} from "@ton/core";
import {BANNED_ASSETS_FROM, BANNED_ASSETS_TO, MIN_WORTH_SWAP_LIMIT} from "../../config";
import {Evaa, ExtendedAssetsConfig, PoolAssetsConfig, PoolConfig} from "@evaafi/sdk";
import {Cell, Dictionary, OpenedContract} from "@ton/ton";
import {sleep} from "../../util/process";
import {formatBalances, getAddressFriendly, getFriendlyAmount} from "../../util/format";
import {Task} from "../../db/types";
import {WalletBalances} from "../../lib/balances";

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
 * @param poolConfig
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
    [0x31F0, "User withdraw in process"],
    [0x31FE, "Liquidation execution crashed"],],
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
    LIQUIDATION_EXECUTION_CRASHED: 0x31FE,
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
    task: Task, loanInfo: AssetInfo, collateralInfo: AssetInfo, parsedTx: ParsedSatisfiedTx,
    txHash: string, txTime: Date, masterAddress: Address,
    myBalance: WalletBalances,
    assetsConfig: ExtendedAssetsConfig,
    poolAssetsConfig: PoolAssetsConfig,
    prices: Dictionary<bigint, bigint>) {
    const {liquidatableAmount, protocolGift, collateralRewardAmount} = parsedTx;

    const {
        query_id: queryID,
        wallet_address: walletAddress,
        contract_address: contractAddress,
        loan_asset: loanId,
        collateral_asset: collateralId,
    } = task;

    const loanPrice = prices.get(loanId)!
    const collateralPrice = prices.get(collateralId)!;
    const transferredLoan = liquidatableAmount + protocolGift;
    const transferredValue = transferredLoan * loanPrice / loanInfo.scale;
    const receivedValue = collateralRewardAmount * collateralPrice / collateralInfo.scale;
    const profit = receivedValue - transferredValue;
    const profitMargin = (Number(profit * 100n) / Number(transferredValue)).toFixed(2);

    return `✅ Liquidation task (Query ID: ${queryID}) successfully completed
<b>Evaa master address: </b> ${getAddressFriendly(masterAddress)}
<b>Loan asset:</b> ${loanInfo.name}
<b>Loan amount:</b> ${getFriendlyAmount(liquidatableAmount, loanInfo.decimals, loanInfo.name)}
<b>Protocol gift: </b> ${getFriendlyAmount(protocolGift, loanInfo.decimals, loanInfo.name)}
<b>Collateral asset:</b> ${collateralInfo.name}
<b>Collateral amount:</b> ${getFriendlyAmount(collateralRewardAmount, collateralInfo.decimals, collateralInfo.name)}
<b>Transferred value: </b> ${getFriendlyAmount(transferredValue, 9n, 'USD')} 
<b>Earned: </b> ${getFriendlyAmount(profit, 9n, 'USD')}
<b>Profit margin: </b> ${profitMargin}%

<b>User address:</b> <code>${getAddressFriendly(Address.parse(walletAddress))}</code>
<b>Contract address:</b> <code>${getAddressFriendly(Address.parse(contractAddress))}</code>
<b>Hash</b>: <code>${txHash}</code>
<b>Time:</b> ${txTime.toLocaleString('en-US', {timeZone: 'UTC'})} UTC

<b>My balance:</b>
${formatBalances(myBalance, assetsConfig, poolAssetsConfig)}`;
}

export function formatLiquidationUnsatisfied(task: Task,
                                             transferredInfo: AssetInfo, collateralInfo: AssetInfo,
                                             loanAmount: bigint, masterAddress: Address,
                                             liquidatorAddress: Address) {
    const {min_collateral_amount, wallet_address} = task;

    return `
<b>Evaa master address: </b> ${getAddressFriendly(masterAddress)}

User address: ${getAddressFriendly(Address.parse(wallet_address))}
Liquidator address: ${getAddressFriendly(liquidatorAddress)}
assetID: ${transferredInfo.name}
transferred amount: ${getFriendlyAmount(loanAmount, transferredInfo.decimals, transferredInfo.name)}
collateralAssetID: ${collateralInfo.name}
minCollateralAmount: ${getFriendlyAmount(min_collateral_amount, collateralInfo.decimals, collateralInfo.name)}\n`
}

export function formatSwapAssignedMessage(loanAsset: AssetInfo, collateralAsset: AssetInfo, collateralRewardAmount: bigint,) {
    const amount = getFriendlyAmount(collateralRewardAmount, collateralAsset.decimals, collateralAsset.name);
    return `<b>Assigned swap task</b> for exchanging of ${amount} for ${loanAsset.name}`;
}

export function formatSwapCanceledMessage(loanInfo: AssetInfo, collateralInfo: AssetInfo, collateralRewardAmount: bigint) {
    return `Swap cancelled (${getFriendlyAmount(collateralRewardAmount, collateralInfo.decimals, collateralInfo.name)} -> ${loanInfo.name})`
}

export type AssetInfo = { name: string, decimals: bigint, scale: bigint }

export function getAssetInfo(assetId: bigint, evaa: OpenedContract<Evaa>): AssetInfo {
    const assetPoolConfig = evaa.poolConfig.poolAssetsConfig.find(it => it.assetId === assetId);
    // throw ok, because no pool config or no data means poll misconfiguration
    if (!assetPoolConfig) throw (`Asset ${assetId} is not supported`);
    if (!evaa.data.assetsConfig.has(assetId)) throw (`No data for asset ${assetId}`);

    const name = assetPoolConfig.name;
    const decimals = evaa.data.assetsConfig.get(assetId)!.decimals;
    const scale = 10n ** decimals;

    return {name, decimals, scale}
}

type ParsedSatisfiedTx = {
    deltaLoanPrincipal: bigint,
    liquidatableAmount: bigint,
    protocolGift: bigint,
    newLoanPrincipal: bigint,
    collateralAssetId: bigint,
    deltaCollateralPrincipal: bigint,
    collateralRewardAmount: bigint,
    // not sure about following data, probably depends on contract version
    // minCollateralAmount: bigint,
    // newCollateralPrincipal: bigint,
    // forwardTonAmount: bigint,
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
    // const minCollateralAmount = extra.loadUintBig(64);
    // const newCollateralPrincipal = extra.loadUintBig(64);
    // const forwardTonAmount = extra.loadUintBig(64);
    // const customResponsePayload: Cell = extra.loadMaybeRef();

    return {
        deltaLoanPrincipal,
        liquidatableAmount,
        protocolGift,
        newLoanPrincipal,
        collateralAssetId,
        deltaCollateralPrincipal,
        collateralRewardAmount,
        // minCollateralAmount,
        // newCollateralPrincipal,
        // forwardTonAmount,
    }
}

export type EvaaError = {
    errorCode: number,
}

export type LiquidationError = EvaaError & {};

export type MasterLiquidatingTooMuchError = LiquidationError & {
    type: 'MasterLiquidatingTooMuchError',
    errorCode: 0x30F1,
    maxAllowedLiquidation: bigint,
}

export type UserWithdrawInProgressError = LiquidationError & {
    type: 'UserWithdrawInProgressError',
    errorCode: 0x31F0,
}
export type NotLiquidatableError = LiquidationError & {
    type: 'NotLiquidatableError',
    errorCode: 0x31F2,
};
export type LiquidationExecutionCrashedError = LiquidationError & {
    type: 'LiquidationExecutionCrashedError',
    errorCode: 0x31FE,
};

export type MinCollateralNotSatisfiedError = LiquidationError & {
    type: 'MinCollateralNotSatisfiedError',
    errorCode: 0x31F3,
    minCollateralAmount: bigint,
};

export type UserNotEnoughCollateralError = LiquidationError & {
    type: 'UserNotEnoughCollateralError',
    errorCode: 0x31F4,
    collateralPresent: bigint,
}

export type UserLiquidatingTooMuchError = LiquidationError & {
    type: 'UserLiquidatingTooMuchError',
    errorCode: 0x31F5,
    maxNotTooMuchValue: bigint,
}

export type MasterNotEnoughLiquidityError = LiquidationError & {
    type: 'MasterNotEnoughLiquidityError',
    errorCode: 0x31F6,
    availableLiquidity: bigint,
}

export type LiquidationPricesMissing = LiquidationError & {
    type: 'LiquidationPricesMissing',
    errorCode: 0x31F7,
}

export type UnknownError = LiquidationError & {
    type: 'UnknownError',
    errorCode: 0xFFFF,
}

export type LiquidationUnsatisfiedError = MasterLiquidatingTooMuchError |
    UserWithdrawInProgressError | NotLiquidatableError |
    LiquidationExecutionCrashedError | MinCollateralNotSatisfiedError |
    UserNotEnoughCollateralError | UserLiquidatingTooMuchError |
    MasterNotEnoughLiquidityError | LiquidationPricesMissing |
    UnknownError;

export type ParsedUnsatisfiedTx = {
    op: number,
    queryID: bigint,
    userAddress: Address,
    liquidatorAddress: Address,
    transferredAssetID: bigint,
    transferredAmount: bigint,
    collateralAssetID: bigint,
    minCollateralAmount: bigint
    forwardTonAmount?: bigint,
    customResponsePayload?: Cell,
    error: LiquidationUnsatisfiedError,
}

export function parseUnsatisfiedTxMsg(body: Slice): ParsedUnsatisfiedTx {
    const op = body.loadUint(32);
    const queryId = body.loadUintBig(64);
    const userAddress = body.loadAddress();
    const liquidatorAddress = body.loadAddress();
    const assetID = body.loadUintBig(256); // transferred
    const nextBody = body.loadRef().beginParse();
    body.endParse();

    const transferredAmount = nextBody.loadUintBig(64);
    const collateralAssetID = nextBody.loadUintBig(256);
    const minCollateralAmount = nextBody.loadUintBig(64);
    let forwardTonAmount = undefined;
    let customResponsePayload = undefined;
    if (nextBody.remainingRefs > 0) {
        forwardTonAmount = nextBody.loadUintBig(64);
        customResponsePayload = nextBody.loadRef();
    }
    let error: LiquidationUnsatisfiedError;
    const errorCode = nextBody.loadUint(32);
    switch (errorCode) {
        case ERROR_CODE.MASTER_LIQUIDATING_TOO_MUCH: {
            const maxAllowedLiquidation = nextBody.loadUintBig(64);
            error = {
                errorCode: 0x30F1,
                type: 'MasterLiquidatingTooMuchError',
                maxAllowedLiquidation: maxAllowedLiquidation
            };
            break;
        }
        case ERROR_CODE.NOT_LIQUIDATABLE: {
            error = {errorCode: 0x31F2, type: 'NotLiquidatableError'};
            break
        }
        case ERROR_CODE.LIQUIDATION_EXECUTION_CRASHED: {
            error = {errorCode: 0x31FE, type: 'LiquidationExecutionCrashedError'};
            break;
        }
        case ERROR_CODE.MIN_COLLATERAL_NOT_SATISFIED: {
            const minCollateralAmount = nextBody.loadUintBig(64);
            error = {errorCode: 0x31F3, type: 'MinCollateralNotSatisfiedError', minCollateralAmount};
            break;
        }
        case ERROR_CODE.USER_NOT_ENOUGH_COLLATERAL: {
            const collateralPresent = nextBody.loadUintBig(64);
            error = {errorCode: 0x31F4, type: 'UserNotEnoughCollateralError', collateralPresent};
            break;
        }
        case ERROR_CODE.USER_LIQUIDATING_TOO_MUCH: {
            const maxNotTooMuchValue = nextBody.loadUintBig(64);
            error = {errorCode: 0x31F5, type: 'UserLiquidatingTooMuchError', maxNotTooMuchValue};
            break;
        }
        case ERROR_CODE.MASTER_NOT_ENOUGH_LIQUIDITY: {
            const availableLiquidity = nextBody.loadUintBig(64);
            error = {errorCode: 0x31F6, type: 'MasterNotEnoughLiquidityError', availableLiquidity};
            break;
        }
        case ERROR_CODE.LIQUIDATION_PRICES_MISSING: {
            error = {errorCode: 0x31F7, type: 'LiquidationPricesMissing'};
            break;
        }
        case ERROR_CODE.USER_WITHDRAW_IN_PROCESS: {
            error = {errorCode: 0x31F0, type: 'UserWithdrawInProgressError'};
            break;
        }
        default: {
            error = {errorCode: 0xFFFF, type: 'UnknownError'};
        }
    }
    return {
        op,
        queryID: queryId,
        userAddress,
        liquidatorAddress,
        transferredAssetID: assetID,
        transferredAmount,
        collateralAssetID,
        minCollateralAmount,
        forwardTonAmount,
        customResponsePayload,
        error
    }
}
