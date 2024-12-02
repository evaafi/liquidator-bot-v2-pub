import {OpenedContract} from "@ton/ton";
import {MyDatabase} from "../../db/database";
import {isAxiosError} from "axios";
import {
    calculateHealthParams,
    calculateLiquidationAmounts,
    Evaa,
    findAssetById,
    PoolConfig,
    selectGreatestAssets,
    TON_MAINNET
} from "@evaafi/sdk";
import {logMessage, Messenger} from "../../lib/messenger";
import {retry} from "../../util/retry";
import {PriceData} from "./types";
import {addLiquidationTask, selectLiquidationAssets} from "./helpers";

export async function validateBalances(db: MyDatabase, evaa: OpenedContract<Evaa>, bot: Messenger, poolConfig: PoolConfig) {
    try {
        const users = await db.getUsers();

        // fetch prices
        const pricesRes = await retry<PriceData>(
            async () => await evaa.getPrices(['evaa.space', 'iota.evaa.finance', 'api.stardust-mainnet.iotaledger.net']),
            {attempts: 10, attemptInterval: 1000}
        );
        if (!pricesRes.ok) throw (`Failed to fetch prices`);
        const {dict: pricesDict, dataCell} = pricesRes.value;

        // sync evaa (required to update rates mostly)
        const evaaSyncRes = await retry(
            async () => await evaa.getSync(),
            {attempts: 10, attemptInterval: 1000}
        );
        if (!evaaSyncRes.ok) throw (`Failed to sync evaa`);

        const assetsDataDict = evaa.data.assetsData;
        const assetsConfigDict = evaa.data.assetsConfig;

        for (const user of users) {
            if (await db.isTaskExists(user.wallet_address)) {
                logMessage(`Validator: Task for ${user.wallet_address} already exists, skipping...`);
                continue;
            }

            const healthParams = calculateHealthParams({
                assetsData: evaa.data.assetsData,
                assetsConfig: evaa.data.assetsConfig,
                principals: user.principals,
                prices: pricesDict,
                poolConfig
            });

            if (!healthParams.isLiquidatable) {
                continue;
            }

            if (healthParams.totalSupply === 0n) {
                const message = `Validator: Problem with user ${user.wallet_address}: account doesn't have collateral at all, and will be blacklisted`;
                logMessage(message);
                await db.blacklistUser(user.wallet_address);
                logMessage(message);
                continue;
            }

            // uncomment this option instead for selectLiquidationAssets if you need simply the greatest pair of assets

            // const {selectedLoanId, selectedCollateralId} = selectGreatestAssets(
            //     user.principals, pricesDict, assetsConfigDict, assetsDataDict, poolConfig
            // );

            // priority assets
            const {selectedLoanId, selectedCollateralId} = selectLiquidationAssets(
                user.principals, pricesDict, assetsConfigDict, assetsDataDict, poolConfig
            );

            const loanAsset = findAssetById(selectedLoanId, poolConfig);
            const collateralAsset = findAssetById(selectedCollateralId, poolConfig);
            const {totalSupply, totalDebt} = healthParams;
            const {
                maxLiquidationAmount, maxCollateralRewardAmount
            } = calculateLiquidationAmounts(
                loanAsset, collateralAsset,
                totalSupply, totalDebt,
                user.principals, pricesDict,
                assetsDataDict, assetsConfigDict,
                poolConfig.masterConstants
            );

            const minCollateralAmount = maxCollateralRewardAmount; // liquidator will deduct dust

            if (!assetsConfigDict.has(collateralAsset.assetId)) {
                logMessage(`Validator: No config for collateral ${collateralAsset.name}, skipping...`);
                continue;
            }
            const collateralConfig = assetsConfigDict.get(collateralAsset.assetId)!;
            const collateralScale = 10n ** collateralConfig.decimals;

            if (!pricesDict.has(collateralAsset.assetId)) {
                logMessage(`Validator: No price for collateral ${collateralAsset.name}, skipping...`);
                continue;
            }
            const collateralPrice = pricesDict.get(collateralAsset.assetId)!;
            if (collateralPrice <= 0) {
                logMessage(`Validator: Invalid price for collateral ${collateralAsset.name}, skipping...`);
                continue;
            }

            const MIN_ALLOWED_COLLATERAL_WORTH = pricesDict.get(TON_MAINNET.assetId); // 1 TON worth in 10**9 decimals
            if (minCollateralAmount * collateralPrice >= MIN_ALLOWED_COLLATERAL_WORTH * collateralScale) {
                await addLiquidationTask(db, user,
                    loanAsset.assetId, collateralAsset.assetId,
                    maxLiquidationAmount, minCollateralAmount,
                    dataCell
                );
                await bot.sendMessage(`Task for ${user.wallet_address} added`);
                logMessage(`Task for ${user.wallet_address} added`);
            } else {
                // console.log(`Not enough collateral for ${user.wallet_address}`);
            }
        }
        // console.log(`Finish validating balances at ${new Date().toLocaleString()}`)
    } catch (e) {
        if (!isAxiosError(e)) {
            console.log(e)
            throw (`Not axios error: ${JSON.stringify(e)}}`);
        }

        if (e.response) {
            logMessage(`Validator: Error: ${e.response.status} - ${e.response.statusText}`);
        } else if (e.request) {
            logMessage(`Validator: Error: No response from server.

${e.request}`);
        } else {
            logMessage(`Validator: Error: unknown`);
        }
        console.log(e)
        logMessage(`Validator: Error while validating balances...`)
    }
}
