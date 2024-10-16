import {Dictionary} from "@ton/ton";
import {COLLATERAL_SELECT_PRIORITY, LT_SCALE, MIN_WORTH_SWAP_LIMIT, NO_PRIORITY_SELECTED} from "../../steady_config";
import {POOL_CONFIG} from "../../config";
import {bigAbs} from "../../util/math";
// import {PoolAssetsConfig, PoolConfig} from "@evaafi/sdkv6";

type MinConfig = {
    decimals: bigint,
    liquidationThreshold: bigint,
    liquidationReserveFactor: bigint,
    liquidationBonus: bigint
};
type MinData = { sRate: bigint, bRate: bigint };

// export function selectLiquidationParameters<Config extends MinConfig, Data extends MinData>(
//     principalsDict: Dictionary<bigint, bigint>,
//     pricesDict: Dictionary<bigint, bigint>,
//     assetsConfigDict: Dictionary<bigint, Config>,
//     assetsDataDict: Dictionary<bigint, Data>,
//     poolAssets: PoolAssetsConfig) {
//
//     const loanAssets: PoolAssetsConfig = [];
//     const collateralAssets: PoolAssetsConfig = [];
//
//     for (const asset of poolAssets) {
//         if (!assetsDataDict.has(asset.assetId)) continue;
//         if (!assetsConfigDict.has(asset.assetId)) continue;
//         if (!principalsDict.has(asset.assetId)) continue;
//         if (!pricesDict.has(asset.assetId)) continue;
//
//         const assetData = assetsDataDict.get(asset.assetId)!;
//         const assetConfig = assetsConfigDict.get(asset.assetId)!;
//         const principal = principalsDict.get(asset.assetId)!;
//         const price = pricesDict.get(asset.assetId)!;
//
//         const value =
//     }
// }

export function addLiquidationReserve(amount: bigint, factorScale: bigint, reserveFactor: bigint): bigint {
    return amount * factorScale * 1000_000n / (factorScale - reserveFactor) / 1000_000n;
}

export function selectLiquidationAssets<
    Config extends MinConfig,
    Data extends MinData
>(
    principalsDict: Dictionary<bigint, bigint>,
    pricesDict: Dictionary<bigint, bigint>,
    assetConfigDict: Dictionary<bigint, Config>,
    assetsDataDict: Dictionary<bigint, Data>,
) {
    let collateralValue = 0n;
    let collateralId = 0n;
    let loanValue = 0n;
    let loanId = 0n;
    let totalDebt = 0n;
    let totalLimit = 0n;

    let priority_collateral_id = 0n;
    let priority_collateral_value = 0n;
    let selected_priority = NO_PRIORITY_SELECTED;
    const FACTOR_SCALE = POOL_CONFIG.masterConstants.FACTOR_SCALE

    for (const assetId of principalsDict.keys()) {
        const principal: bigint = principalsDict.get(assetId)!;
        const assetPrice = pricesDict.get(assetId);
        if (!assetPrice) {
            console.warn(`No price for assetId ${assetId}`);
            continue;
        }
        const assetData = assetsDataDict.get(assetId)!;
        if (!assetData) {
            console.warn(`Dynamics for assetId ${assetId} is not defined, skipping`);
            continue;
        }
        const assetConfig = assetConfigDict.get(assetId);
        if (!assetConfig) {
            console.warn(`Config for assetId ${assetId} is not defined, skipping`);
            continue;
        }
        const {decimals, liquidationThreshold} = assetConfig;
        const assetScale = 10n ** decimals;
        let balance = 0n;
        if (principal > 0n) {
            balance = (BigInt(principal) * BigInt(assetData.sRate) / BigInt(FACTOR_SCALE)).valueOf();
        } else {
            balance = (BigInt(principal) * BigInt(assetData.bRate) / BigInt(FACTOR_SCALE)).valueOf();
        }

        const assetWorth = bigAbs(balance) * assetPrice / assetScale;
        if (balance > 0n) {
            totalLimit += assetWorth * liquidationThreshold / LT_SCALE;

            // priority based collateral selection logic
            if (assetWorth > MIN_WORTH_SWAP_LIMIT) {
                const priority = COLLATERAL_SELECT_PRIORITY.get(assetId);
                if ((priority !== undefined) && (selected_priority > priority)) {
                    selected_priority = priority;
                    priority_collateral_id = assetId;
                    priority_collateral_value = assetWorth;
                }
            }

            if (assetWorth > collateralValue) {
                collateralValue = assetWorth;
                collateralId = assetId;
            }
        } else if (balance < 0n) {
            totalDebt += assetWorth;
            if (assetWorth > loanValue) {
                loanValue = assetWorth;
                loanId = assetId;
            }
        }
    }

    // use old collateral selection logic
    if (selected_priority < NO_PRIORITY_SELECTED) {
        collateralId = priority_collateral_id;
        collateralValue = priority_collateral_value;
    }

    return {
        collateralValue, collateralId,
        loanValue, loanId,
        totalDebt, totalLimit,
    }
}
