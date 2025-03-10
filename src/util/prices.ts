import {Cell, Dictionary} from "@ton/ton";

export function unpackPrices(pricesCell: Cell): Dictionary<bigint, bigint> | undefined {
    if (!pricesCell) return undefined;
    const slice = pricesCell.beginParse();
    let assetCell: Cell | null = slice.loadRef();
    const res = Dictionary.empty<bigint, bigint>();
    while (assetCell != Cell.EMPTY && assetCell !== null) {
        const slice = assetCell.beginParse();
        const assetId = slice.loadUintBig(256);
        const medianPrice = slice.loadCoins();
        res.set(assetId, medianPrice);
        assetCell = slice.loadMaybeRef();

    }
    return res;
}

export type OracleInfoItem = {
    oracle_id: number,
    signature: Buffer,
    timestamp: number,
}

export type PriceDataPartialInfo = {
    medianPricesDict: Dictionary<bigint, bigint>,
    oraclesInfos: OracleInfoItem[]
}

export function parsePriceDataPartial(priceData: Cell): PriceDataPartialInfo {
    const priceDataSlice = priceData.beginParse();
    const medianPricesDict = Dictionary.empty<bigint, bigint>();
    let ref = priceDataSlice.loadRef();

    // parse median prices dict
    while (true) {
        const s = ref.beginParse();
        medianPricesDict.set(s.loadUintBig(256), s.loadCoins());
        if (s.remainingRefs > 0) {
            ref = s.loadRef();
        } else break;
    }

    let oracleData = priceDataSlice.loadRef();
    const oraclesInfos: OracleInfoItem[] = [];
    let oracleSlice = oracleData.beginParse();

    while (true) {
        const oracle_id = oracleSlice.loadUint(32);
        const signature = oracleSlice.loadBuffer(64);
        const merkle_proof = oracleSlice.loadRef();
        const pruned_data = merkle_proof.refs[0];
        const pruned_slice = pruned_data.beginParse();
        const timestamp = pruned_slice.loadUint(32);

        oraclesInfos.push({
            oracle_id,
            timestamp,
            signature,

        });

        if (oracleSlice.remainingRefs === 0) break;
        oracleSlice = oracleSlice.loadRef().beginParse();
    }
    return {
        medianPricesDict,
        oraclesInfos
    }
}

export const CheckOraclesEnum = {
    OK: 0,
    OUT_OF_DATE: 1,
    NOT_ENOUGH_ORACLES: 2,
    HAS_DUPLICATE_IDS: 3,
    HAS_DUPLICATE_SIGNATURES: 4,
    INVALID_PRICE_DATA: 5,
}

export const CheckOraclesMessage = [
    'OK',
    'Price data is out of date',
    'Number of oracles is not enough',
    'Price data has duplicate oracle ids',
    'Invalid price data, cannot be parsed',
];

/**
 * @brief do fast checks if price data cell is ok
 * @param priceData price data cell
 * @param maxSecondsPassed max seconds since data issued
 */
export function checkPriceData(priceData: Cell, maxSecondsPassed: number): number {
    const now = Date.now() / 1000;
    try {
        const res = parsePriceDataPartial(priceData);
        const oracles = res.oraclesInfos;
        if (oracles.length < 3) return CheckOraclesEnum.NOT_ENOUGH_ORACLES;

        const oracleIds = oracles.map(item=>item.oracle_id);
        if (oracles.length !== (new Set(oracleIds).size)) {
            return CheckOraclesEnum.HAS_DUPLICATE_IDS;
        }

        for (const oracle of oracles) {
            if (now - oracle.timestamp > maxSecondsPassed) {
                return CheckOraclesEnum.OUT_OF_DATE;
            }
        }
    } catch (e) {
        return CheckOraclesEnum.INVALID_PRICE_DATA;
    }

    return CheckOraclesEnum.OK;
}

export function isPriceDataActual(priceData: Cell, maxSecondsPassed: number): boolean {
    const now = Date.now() / 1000;
    try {
        const res = parsePriceDataPartial(priceData);
        for (const oracle of res.oraclesInfos) {
            if (now - oracle.timestamp > maxSecondsPassed) return false;
        }
    } catch (e) {
        return false;
    }

    return true;
}
