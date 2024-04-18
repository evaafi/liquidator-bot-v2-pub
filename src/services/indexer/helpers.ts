import {decimals, isTestnet} from "../../config";
import {Address} from "@ton/core";

export function getAddressFriendly(addr: Address) {
    return isTestnet ?
        addr.toString({
            bounceable: true,
            testOnly: true
        }) :
        addr.toString({
            bounceable: true,
            testOnly: false
        })
}

export function getRequest(address: Address, before_lt: number) {
    if(before_lt === 0)
        return `v2/blockchain/accounts/${address.toRawString()}/transactions?limit=1000`
    else
        return `v2/blockchain/accounts/${address.toRawString()}/transactions?before_lt=${before_lt}&limit=1000`
}

export function getAssetName(assetId: bigint) {
    switch (assetId) {
        case 11876925370864614464799087627157805050745321306404563164673853337929163193738n:
            return "TON";
        case 81203563022592193867903899252711112850180680126331353892172221352147647262515n:
            return "USDT";
        case 59636546167967198470134647008558085436004969028957957410318094280110082891718n:
            return "USDC";
        case 33171510858320790266247832496974106978700190498800858393089426423762035476944n:
            return "stTON";
        default:
            return "Unknown";
    }
}

export function getFriendlyAmount(amount: bigint, assetName: string) {
    let amt = Number(amount);
    if (assetName === "TON" || assetName === "stTON" || assetName === "tsTON") {
        amt = amt / Number(decimals.ton);
        return amt.toFixed(2) + " " + assetName;
    } else {
        amt = amt / Number(decimals.jetton);
        return amt.toFixed(2) + " " + assetName;
    }
}