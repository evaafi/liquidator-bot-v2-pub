import {Address, Cell, Dictionary} from "@ton/ton";

export type AssetData = {
    sRate: bigint;
    bRate: bigint;
    totalSupply: bigint;
    totalBorrow: bigint;
    lastAccural: bigint;
    balance: bigint;
}

export type Prices = {
    status: string
    packedPrices: string
    signature: string
}

export type AssetConfig = {
    oracle: bigint;
    decimals: bigint;
    collateralFactor: bigint;
    liquidationThreshold: bigint;
    liquidationBonus: bigint;
    baseBorrowRate: bigint;
    borrowRateSlopeLow: bigint;
    borrowRateSlopeHigh: bigint;
    supplyRateSlopeLow: bigint;
    supplyRateSlopeHigh: bigint;
    targetUtilization: bigint;
    originationFee: bigint;
};

export type PriceData = {
    dict: Dictionary<bigint, bigint>;
    dataCell: Cell;
};

export type MiddlewareData = {
    pricesCell: Cell,
    signature: Buffer
}