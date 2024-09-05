import {AssetDecimals, BANNED_ASSETS_FROM, BANNED_ASSETS_TO, isTestnet, MIN_WORTH_SWAP_LIMIT} from "../../config";
import {Address} from "@ton/core";
import {getPrices} from "../../util/prices";

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
    if (before_lt === 0)
        return `v2/blockchain/accounts/${address.toRawString()}/transactions?limit=1000`
    else
        return `v2/blockchain/accounts/${address.toRawString()}/transactions?before_lt=${before_lt}&limit=1000`
}

export function getAssetName(assetId: bigint) {
    switch (assetId) {
        case 11876925370864614464799087627157805050745321306404563164673853337929163193738n:
            return 'TON';
        case 81203563022592193867903899252711112850180680126331353892172221352147647262515n:
            return 'jUSDT';
        case 59636546167967198470134647008558085436004969028957957410318094280110082891718n:
            return 'jUSDC';
        case 33171510858320790266247832496974106978700190498800858393089426423762035476944n:
            return 'stTON';
        case 23103091784861387372100043848078515239542568751939923972799733728526040769767n:
            return 'tsTON';
        case 91621667903763073563570557639433445791506232618002614896981036659302854767224n:
            return 'USDT';
        case 101385043286520300676049067359330438448373069137841871026562097979079540439904n:
            return 'TONUSDT_DEDUST';
        case 45271267922377506789669073275694049849109676194656489600278771174506032218722n:
            return 'TONUSDT_STONFI';
        case 70772196878564564641575179045584595299167675028240038598329982312182743941170n:
            return 'TON_STORM';
        case 48839312865341050576546877995196761556581975995859696798601599030872576409489n:
            return 'USDT_STORM';
        default:
            break;
    }
    return "Unknown";
}

export function getFriendlyAmount(amount: bigint, assetName: string) {
    let amt = Number(amount);
    const decimals = AssetDecimals[assetName];
    if (decimals === undefined) return 'Unknown asset';
    amt /= Number(decimals);
    return amt.toFixed(2) + " " + assetName;
}

export function isBannedSwapFrom(assetID: bigint): boolean {
    return BANNED_ASSETS_FROM.findIndex(value => value === assetID) >= 0;
}

export function isBannedSwapTo(assetID: bigint): boolean {
    return BANNED_ASSETS_TO.findIndex(value => value === assetID) >= 0;
}

export function getAssetDecimals(assetID: bigint): bigint {
    const assetName = getAssetName(assetID);
    return AssetDecimals[assetName];
}

/**
 * @param assetFrom asset to exchange from (database specific asset id)
 * @param assetAmount amount of assets in its wei
 * @param assetTo asset to exchange to (database specific asset id)
 */
export async function checkEligibleSwapTask(assetFrom: bigint, assetAmount: bigint, assetTo: bigint): Promise<boolean> {
    const {dict: prices} = await getPrices();
    if (prices === undefined) {
        console.error(`Failed to obtain prices from middleware!`);
        return false;
    }

    if (isBannedSwapFrom(assetFrom)) {
        console.error(`Cant swap ${getAssetName(assetFrom)} asset!`);
        return false;
    }

    if (isBannedSwapTo(assetTo)) {
        console.error(`Cant swap to ${getAssetName(assetTo)} asset!`);
        return false;
    }

    const assetPrice = prices.get(assetFrom);
    if (assetPrice === undefined) {
        console.error(`No price for asset`);
        return false;
    }
    const assetName = getAssetName(assetFrom).toLocaleLowerCase();
    const assetDecimals = getAssetDecimals(assetFrom);
    if (assetDecimals === undefined) {
        console.error("Invalid asset id: ", assetName);
        return false;
    }

    const assetWorth = assetAmount * assetPrice / assetDecimals; // norm_price * PRICE_ACCURACY(10**9)

    return assetWorth > MIN_WORTH_SWAP_LIMIT;
}
