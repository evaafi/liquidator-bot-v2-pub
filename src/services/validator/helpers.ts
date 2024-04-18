import {beginCell, Cell, DictionaryValue, Slice} from "@ton/ton";
import {AssetConfig, AssetData, MiddlewareData} from "./types";
import crypto from "crypto";
import {NFT_ID} from "../../config";

export function createAssetData(): DictionaryValue<AssetData> {
    return {
        serialize: (src: any, buidler: any) => {
            buidler.storeUint(src.s_rate, 64);
            buidler.storeUint(src.b_rate, 64);
            buidler.storeUint(src.totalSupply, 64);
            buidler.storeUint(src.totalBorrow, 64);
            buidler.storeUint(src.lastAccural, 32);
            buidler.storeUint(src.balance, 64);
        },
        parse: (src: Slice) => {
            const sRate = BigInt(src.loadUint(64));
            const bRate = BigInt(src.loadUint(64));
            const totalSupply = BigInt(src.loadUint(64));
            const totalBorrow = BigInt(src.loadUint(64));
            const lastAccural = BigInt(src.loadUint(32));
            const balance = BigInt(src.loadUint(64));
            return { sRate, bRate, totalSupply, totalBorrow, lastAccural, balance };
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

export function sha256Hash(input: string): bigint {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    const hashBuffer = hash.digest();
    const hashHex = hashBuffer.toString('hex');
    return BigInt('0x' + hashHex);
}



export const bigIntMin = (...args) => args.reduce((m, e) => e < m ? e : m);
export const bigIntMax = (...args) => args.reduce((m, e) => e > m ? e : m);

export async function getMiddlewareData(): Promise<MiddlewareData | undefined> {
    try {
        let outputId = await (await fetch('https://api.stardust-mainnet.iotaledger.net/api/indexer/v1/outputs/nft/' + NFT_ID,
            { headers: { "accept": "application/json" } })).json()
        // @ts-ignore
        let resData = await (await fetch('https://api.stardust-mainnet.iotaledger.net/api/core/v2/outputs/' + outputId.items[0],
            { headers: { "accept": "application/json" } })).json()

        // @ts-ignore
        const data = JSON.parse(decodeURIComponent(resData.output.features[0].data.replace('0x', '').replace(/[0-9a-f]{2}/g, '%$&')));
        return {
            pricesCell: (Cell.fromBoc(Buffer.from(data['packedPrices'], 'hex'))[0]),
            signature: (Buffer.from(data['signature'], 'hex'))
        };
    } catch (error) {
        console.error(error)
        return undefined;
    }
}
