import {WalletBalances} from "../../lib/balances";
import {formatBalances, getFriendlyAmount} from "../../util/format";
import {ExtendedAssetsConfig, ExtendedAssetsData, MasterConstants, PoolAssetsConfig, presentValue} from "@evaafi/sdk";
import {POOL_CONFIG} from "../../config";

type TaskMinimal = {
    id: number,
    loan_asset: bigint,
    liquidation_amount: bigint,
}

export function formatNotEnoughBalanceMessage<Task extends TaskMinimal>(task: Task, balance: WalletBalances, extAssetsConfig: ExtendedAssetsConfig, poolAssetsConfig: PoolAssetsConfig) {
    const assets = POOL_CONFIG.poolAssetsConfig;
    const loan_asset = assets.find(asset => (asset.assetId === task.loan_asset));
    if (!loan_asset) throw (`${task.loan_asset} is not supported`);

    const formattedBalances = formatBalances(balance, extAssetsConfig, poolAssetsConfig);
    const loan_config = extAssetsConfig.get(task.loan_asset);
    if (!loan_config) throw (`No config for asset ${task.loan_asset}`);

    return `
❌ Not enough balance for liquidation task ${task.id}

<b>Loan asset:</b> ${loan_asset.name}
<b>Liquidation amount:</b> ${getFriendlyAmount(task.liquidation_amount, loan_config.decimals, loan_asset.name)}
<b>My balance:</b>
${formattedBalances}`;
}

export type Log = {
    id: number,
    walletAddress: string,
}

/**
 * Calculates asset dust amount
 * @param assetId asset id
 * @param assetsConfigDict assets config collection
 * @param assetsDataDict assets data collection
 * @param masterConstants master constants
 */
export function calculateDust(
    assetId: bigint,
    assetsConfigDict: ExtendedAssetsConfig,
    assetsDataDict: ExtendedAssetsData,
    masterConstants: MasterConstants) {

    const data = assetsDataDict.get(assetId)!;
    const config = assetsConfigDict.get(assetId)!;

    const dustPresent = presentValue(data.sRate, data.bRate, config.dust, masterConstants);
    return dustPresent.amount;
}