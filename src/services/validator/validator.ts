import {Cell, Dictionary, OpenedContract} from "@ton/ton";
import {MyDatabase} from "../../db/database";
import {isAxiosError} from "axios";
import {
    calculateHealthParams,
    calculateLiquidationAmounts,
    Evaa,
    findAssetById,
    PoolConfig,
    PricesCollector,
    TON_MAINNET
} from "@evaafi/sdk";
import {logMessage, Messenger} from "../../lib/messenger";
import {retry} from "../../util/retry";
import {PriceData} from "./types";
import {addLiquidationTask, selectLiquidationAssets} from "./helpers";
import {CheckOraclesEnum, CheckOraclesMessage, checkPriceData} from "../../util/prices";
import {VALIDATOR_MAX_PRICES_ISSUED, LIQUIDATOR_PRICES_UPDATE_INTERVAL} from "../../steady_config";

export async function validateBalances(db: MyDatabase, evaa: OpenedContract<Evaa>, evaaPriceCollector: PricesCollector, bot: Messenger, poolConfig: PoolConfig) {
    try {
        const users = await db.getUsers();

        let pricesDict: Dictionary<bigint, bigint>;
        let pricesCell: Cell;
        let lastPricesSync = 0; // not up to date
        const isPriceDataActual = () => (Date.now() - lastPricesSync) / 1000 < LIQUIDATOR_PRICES_UPDATE_INTERVAL;

        const updatePrices = async () => {
            if (isPriceDataActual()) return;

            // fetch prices
            const pricesRes = await retry<PriceData>(
                async () => await evaaPriceCollector.getPrices(),
                {attempts: 10, attemptInterval: 1000}
            );
            if (!pricesRes.ok) throw new Error(`Failed to fetch prices`);

            const res = checkPriceData(pricesRes.value.dataCell, VALIDATOR_MAX_PRICES_ISSUED);
            if (res !== CheckOraclesEnum.OK) {
                throw new Error(`${CheckOraclesMessage.at(res)}, cannot continue`);
            }

            pricesDict = pricesRes.value.dict;
            pricesCell = pricesRes.value.dataCell;
            lastPricesSync = Date.now();
            logMessage('Prices updated, data is ok');
        }

        // sync evaa (required to update rates mostly)
        const evaaSyncRes = await retry(
            async () => await evaa.getSync(),
            {attempts: 10, attemptInterval: 1000}
        );
        if (!evaaSyncRes.ok) {
            throw new Error(`Failed to sync evaa`);
        }

        const assetsDataDict = evaa.data.assetsData;
        const assetsConfigDict = evaa.data.assetsConfig;

        for (const user of users) {
            await updatePrices();

            if (await db.isTaskExists(user.wallet_address)) {
                logMessage(`Validator: Task for ${user.wallet_address} already exists, skipping...`);
                continue;
            }

            let healthParams: any; // TODO: add return type to sdk

            try {
                healthParams = calculateHealthParams({
                    assetsData: evaa.data.assetsData,
                    assetsConfig: evaa.data.assetsConfig,
                    principals: user.principals,
                    prices: pricesDict,
                    poolConfig
                });
            } catch (e) {
                logMessage(`Failed to calculate heath factor for user ${user.wallet_address}`);
                console.log(e);
                continue;
            }

            if (!healthParams.isLiquidatable) {
                continue;
            }

            if (healthParams.totalSupply === 0n) {
                const message = `Validator: Problem with user ${user.wallet_address}: account doesn't have collateral at all, and will be blacklisted`;
                logMessage(message);
                if (!await db.blacklistUser(user.wallet_address)) {
                    await bot.sendMessage(`${message} : Failed to blacklist user`);
                } else {
                    await bot.sendMessage(`${message} : User was blacklisted`);
                }
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
            if (!loanAsset || !collateralAsset) {
                logMessage(`Failed to select loan or collateral for liquidation: loan id: ${selectedLoanId}, collateral id: ${selectedCollateralId}, skipping user`);
                continue;
            }
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
                const res = await addLiquidationTask(db, user,
                    loanAsset.assetId, collateralAsset.assetId,
                    maxLiquidationAmount, minCollateralAmount,
                    pricesCell
                );

                console.log('health params for liquidation:', {healthParams});

                if (!res) {
                    await bot.sendMessage(`Failed to add db task for user ${user.wallet_address}`);
                    // continue;
                } else {
                    await bot.sendMessage(`Task for ${user.wallet_address} added`);
                    logMessage(`Task for ${user.wallet_address} added`);
                }
            } else {
                // logMessage(`Not enough collateral for ${user.wallet_address}`);
            }
        }
        // logMessage(`Finish validating balances.`)
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
