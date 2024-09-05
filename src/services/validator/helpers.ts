import {beginCell, DictionaryValue, Slice} from "@ton/ton";
import {AssetConfig, AssetData} from "./types";

export function createAssetData(): DictionaryValue<AssetData> {
    return {
        serialize: (src: any, buidler: any) => {
            buidler.storeUint(src.s_rate, 64);
            buidler.storeUint(src.b_rate, 64);
            buidler.storeUint(src.totalSupply, 64);
            buidler.storeUint(src.totalBorrow, 64);
            buidler.storeUint(src.lastAccrual, 32);
            buidler.storeUint(src.balance, 64);
        },
        parse: (src: Slice) => {
            const sRate = BigInt(src.loadUint(64));
            const bRate = BigInt(src.loadUint(64));
            const totalSupply = BigInt(src.loadUint(64));
            const totalBorrow = BigInt(src.loadUint(64));
            const lastAccrual = BigInt(src.loadUint(32));
            const balance = BigInt(src.loadUint(64));
            return {sRate, bRate, totalSupply, totalBorrow, lastAccrual, balance};
        },
    };
}

export function createAssetConfig(): DictionaryValue<AssetConfig> {
    return {
        serialize: (src: any, builder: any) => {
            builder.storeUint(src.oracle, 256);
            builder.storeUint(src.decimals, 8);
            const refBuild = beginCell();
            refBuild.storeUint(src.collateralFactor, 16);
            refBuild.storeUint(src.liquidationThreshold, 16);
            refBuild.storeUint(src.liquidationPenalty, 16);
            refBuild.storeUint(src.baseBorrowRate, 64);
            refBuild.storeUint(src.borrowRateSlopeLow, 64);
            refBuild.storeUint(src.borrowRateSlopeHigh, 64);
            refBuild.storeUint(src.supplyRateSlopeLow, 64);
            refBuild.storeUint(src.supplyRateSlopeHigh, 64);
            refBuild.storeUint(src.targetUtilization, 64);
            refBuild.storeUint(src.originationFee, 64);
            builder.storeRef(refBuild.endCell());
        },
        parse: (src: Slice) => {
            const oracle = src.loadUintBig(256);
            const decimals = BigInt(src.loadUint(8));
            const ref = src.loadRef().beginParse();
            const collateralFactor = BigInt(ref.loadUint(16));
            const liquidationThreshold = BigInt(ref.loadUint(16));
            const liquidationBonus = BigInt(ref.loadUint(16));
            const baseBorrowRate = BigInt(ref.loadUint(64));
            const borrowRateSlopeLow = BigInt(ref.loadUint(64));
            const borrowRateSlopeHigh = BigInt(ref.loadUint(64));
            const supplyRateSlopeLow = BigInt(ref.loadUint(64));
            const supplyRateSlopeHigh = BigInt(ref.loadUint(64));
            const targetUtilization = BigInt(ref.loadUint(64));
            const originationFee = BigInt(ref.loadUint(64));

            return {
                oracle,
                decimals,
                collateralFactor,
                liquidationThreshold,
                liquidationBonus,
                baseBorrowRate,
                borrowRateSlopeLow,
                borrowRateSlopeHigh,
                supplyRateSlopeLow,
                supplyRateSlopeHigh,
                targetUtilization,
                originationFee,
            };
        },
    };
}

export const bigIntMin = (...args) => args.reduce((m, e) => e < m ? e : m);
export const bigIntMax = (...args) => args.reduce((m, e) => e > m ? e : m);
