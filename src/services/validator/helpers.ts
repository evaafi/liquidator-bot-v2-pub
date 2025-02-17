import {Cell, Dictionary} from "@ton/ton";
import {COLLATERAL_SELECT_PRIORITY, MIN_WORTH_SWAP_LIMIT, NO_PRIORITY_SELECTED} from "../../config";
import {bigAbs} from "../../util/math";
import {
    ExtendedAssetsConfig,
    ExtendedAssetsData,
    MasterConstants,
    PoolConfig,
    presentValue,
    SelectedAssets
} from "@evaafi/sdk";
import {MyDatabase} from "../../db/database";
import {User} from "../../db/types";
import {retry} from "../../util/retry";

type MinConfig = {
    decimals: bigint,
    liquidationThreshold: bigint,
    liquidationReserveFactor: bigint,
    liquidationBonus: bigint
};
type MinData = { sRate: bigint, bRate: bigint };


export function selectLiquidationAssets<Config extends MinConfig, Data extends MinData>(
    principalsDict: Dictionary<bigint, bigint>,
    pricesDict: Dictionary<bigint, bigint>,
    assetConfigDict: Dictionary<bigint, Config>,
    assetsDataDict: Dictionary<bigint, Data>,
    poolConfig: PoolConfig
): SelectedAssets {
    let collateralValue = 0n;
    let collateralId = 0n;
    let loanValue = 0n;
    let loanId = 0n;

    let priority_collateral_id = 0n;
    let priority_collateral_value = 0n;
    let selected_priority = NO_PRIORITY_SELECTED;
    const FACTOR_SCALE = poolConfig.masterConstants.FACTOR_SCALE

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
        const assetScale = 10n ** assetConfig.decimals;
        let balance = 0n;
        if (principal > 0n) {
            balance = (BigInt(principal) * BigInt(assetData.sRate) / BigInt(FACTOR_SCALE)).valueOf();
        } else {
            balance = (BigInt(principal) * BigInt(assetData.bRate) / BigInt(FACTOR_SCALE)).valueOf();
        }

        const assetValue = bigAbs(balance) * assetPrice / assetScale;
        if (balance > 0n) {
            // priority based collateral selection logic
            if (assetValue > MIN_WORTH_SWAP_LIMIT) {
                const priority = COLLATERAL_SELECT_PRIORITY.get(assetId);
                if ((priority !== undefined) && (selected_priority > priority)) {
                    selected_priority = priority;
                    priority_collateral_id = assetId;
                    priority_collateral_value = assetValue;
                }
            }

            if (assetValue > collateralValue) {
                collateralValue = assetValue;
                collateralId = assetId;
            }
        } else if (balance < 0n) {
            if (assetValue > loanValue) {
                loanValue = assetValue;
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
        selectedCollateralId: collateralId,
        selectedCollateralValue: collateralValue,
        selectedLoanId: loanId,
        selectedLoanValue: loanValue,
    }
}

export async function addLiquidationTask(
    db: MyDatabase, user: User,
    loanAssetId: bigint, collateralAssetId: bigint,
    liquidationAmount: bigint, minCollateralAmount: bigint,
    pricesCell: Cell) {

    const queryID = BigInt(Date.now());

    console.log('ADDING LIQUIDATE TASK TO DB: ', {
        user: user.wallet_address,
        loanAssetId,
        collateralAssetId,
        liquidationAmount,
        minCollateralAmount,
        queryID
    });

    // db might be busy, retry 5 times, wait 1 sec before retry
    const res = await retry(async () => {
            await db.addTask(
                user.wallet_address, user.contract_address, Date.now(),
                loanAssetId, collateralAssetId,
                liquidationAmount, minCollateralAmount,
                pricesCell.toBoc().toString('base64'),
                queryID);
        }, {attempts: 5, attemptInterval: 1000}
    );

    return res.ok;
}
