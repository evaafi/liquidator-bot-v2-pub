import {Address} from "@ton/core";
import {IS_TESTNET} from "../config";
import {WalletBalances} from "../lib/balances";
import {Dictionary} from "@ton/ton";
import {ExtendedAssetsConfig, PoolAssetsConfig} from "@evaafi/sdk";

export function getAddressFriendly(addr: Address) {
    return IS_TESTNET ?
        addr.toString({
            bounceable: true,
            testOnly: true
        }) :
        addr.toString({
            bounceable: true,
            testOnly: false
        })
}

export function getFriendlyAmount(amount: bigint, decimals: bigint, name: string) {
    let amt = Number(amount);
    const scale = (10n ** decimals);
    amt /= Number(scale);
    return amt.toFixed(2) + " " + name;
}

export function formatBalances(balances: WalletBalances, extAssetsConfig: ExtendedAssetsConfig, poolAssetsConfig: PoolAssetsConfig) {
    return poolAssetsConfig.map(asset => {
        const assetConfig = extAssetsConfig.get(asset.assetId);
        if (!assetConfig) throw (`No config for asset ${asset.assetId}`);
        const decimals: bigint = assetConfig.decimals;
        const balance: bigint = balances.get(asset.assetId) ?? 0n;
        const name = asset.name;
        return `<b>- ${asset.name}:</b> ${getFriendlyAmount(balance, decimals, name)}`;
    }).join('\n');
}

export function printPrices(prices: Dictionary<bigint, bigint>) {
    prices.keys().forEach((assetId) => {
        const price = prices.get(assetId);
        console.log(`Asset: ${assetId}: ${Number(price) / 10 ** 9}`);
    })
}

export function repeatStr(s: string, n: number) {
    return Array.from({length: n}, () => s)
}
