import {WalletBalances} from "../../lib/balances";
import {formatBalances, getFriendlyAmount} from "../../util/format";
import {ExtendedAssetsConfig} from "@evaafi/sdkv6";
import {POOL_CONFIG} from "../../config";

type TaskMinimal = {
    id: number,
    loan_asset: bigint,
    liquidation_amount: bigint,
}

export function formatNotEnoughBalanceMessage<Task extends TaskMinimal>(task: Task, balance: WalletBalances, extAssetsConfig: ExtendedAssetsConfig) {
    const assets = POOL_CONFIG.poolAssetsConfig;
    const loan_asset = assets.find(asset => (asset.assetId === task.loan_asset));
    if (!loan_asset) throw (`${task.loan_asset} is not supported`);

    const formattedBalances = formatBalances(balance, extAssetsConfig);
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
