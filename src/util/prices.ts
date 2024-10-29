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
