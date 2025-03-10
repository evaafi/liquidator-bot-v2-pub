import {KeyPair} from "@ton/crypto";
import {Address} from "@ton/core";
import {Cell, Dictionary, OpenedContract, toNano, TonClient} from "@ton/ton";

import {
    BigMath,
    calculateMinCollateralByTransferredAmount,
    Evaa,
    FEES,
    findAssetById,
    LiquidationParameters,
    TON_MAINNET
} from "@evaafi/sdk";
import {JETTON_WALLETS, LIQUIDATION_BALANCE_LIMITS, LIQUIDATOR_MAX_PRICES_ISSUED} from "../../config";

import {DATABASE_DEFAULT_RETRY_OPTIONS, MyDatabase} from "../../db/database";
import {HighloadWalletV2, makeLiquidationCell} from "../../lib/highload_contract_v2";
import {retry} from "../../util/retry";
import {getBalances, WalletBalances} from "../../lib/balances";
import {getAddressFriendly} from "../../util/format";
import {logMessage, Messenger} from "../../lib/messenger";
import {calculateDust, formatNotEnoughBalanceMessage, getJettonIDs, Log} from "./helpers";
import {isPriceDataActual} from "../../util/prices";

const MAX_TASKS_FETCH = 100;

export async function handleLiquidates(db: MyDatabase, tonClient: TonClient,
                                       highloadContract: HighloadWalletV2, highloadAddress: Address,
                                       evaa: OpenedContract<Evaa>,
                                       keys: KeyPair, bot: Messenger) {
    const dust = (assetId: bigint) => {
        return calculateDust(assetId, evaa.data.assetsConfig, evaa.data.assetsData, evaa.poolConfig.masterConstants);
    }

    const cancelOldTasksRes = await retry(
        async () => await db.cancelOldTasks(),
        DATABASE_DEFAULT_RETRY_OPTIONS
    );
    if (!cancelOldTasksRes.ok) {
        await bot.sendMessage('Failed to cancel old tasks, database probably is busy...');
    }
    const tasks = await db.getTasks(MAX_TASKS_FETCH);
    const jettonIDs = getJettonIDs(evaa);

    const liquidatorBalances: WalletBalances = await getBalances(tonClient, highloadAddress, jettonIDs, JETTON_WALLETS);

    const log: Log[] = [];
    const highloadMessages = Dictionary.empty<number, Cell>();

    for (const task of tasks) {
        let liquidatorLoanBalance = liquidatorBalances.get(task.loan_asset) ?? 0n;
        if (liquidatorLoanBalance < LIQUIDATION_BALANCE_LIMITS.get(task.loan_asset)) {
            logMessage(`Liquidator: Not enough balance for liquidation task ${task.id}`);
            await bot.sendMessage(formatNotEnoughBalanceMessage(task, liquidatorBalances, evaa.data.assetsConfig, evaa.poolConfig.poolAssetsConfig));
            await db.cancelTaskNoBalance(task.id);
            continue;
        }

        const {
            liquidation_amount: maxLiquidationAmount,
            min_collateral_amount: maxRewardAmount
        } = task;

        const loanDust = dust(task.loan_asset)
        const collateralDust = dust(task.collateral_asset)

        let allowedLiquidationAmount: bigint;
        let liquidationAmount: bigint;
        let quotedCollateralAmount = maxRewardAmount;

        if (task.loan_asset === TON_MAINNET.assetId) {
            allowedLiquidationAmount = BigMath.min(maxLiquidationAmount, liquidatorLoanBalance - toNano(2));
            liquidationAmount = BigMath.min(maxLiquidationAmount + loanDust, liquidatorLoanBalance - toNano(2));
        } else {
            allowedLiquidationAmount = BigMath.min(maxLiquidationAmount, liquidatorLoanBalance);
            liquidationAmount = BigMath.min(maxLiquidationAmount + loanDust, liquidatorLoanBalance);
        }

        if (liquidatorLoanBalance < maxLiquidationAmount) {
            quotedCollateralAmount = calculateMinCollateralByTransferredAmount(
                allowedLiquidationAmount, maxLiquidationAmount, maxRewardAmount
            );
        }

        task.liquidation_amount = liquidationAmount;
        // TODO: update coefficient after thorough check
        task.min_collateral_amount = quotedCollateralAmount * 97n / 100n - collateralDust;

        console.log({
            walletAddress: task.wallet_address,
            liquidationAmount: task.liquidation_amount,
            collateralAmount: task.min_collateral_amount
        });

        const priceData = Cell.fromBase64(task.prices_cell);
        // check priceData is up-to-date
        if (!isPriceDataActual(priceData, LIQUIDATOR_MAX_PRICES_ISSUED)) {
            const message = `Price data for task ${task.id} is too old, task will be canceled`;
            console.log(message);
            await bot.sendMessage(message);
            await retry(
                async () => await db.cancelTask(task.id),
                DATABASE_DEFAULT_RETRY_OPTIONS
            ); // if failed to access database it's not critical, just go on
            continue;
        }

        let liquidationBody = Cell.EMPTY; // compose liquidation body
        const loanAsset = findAssetById(task.loan_asset, evaa.poolConfig);
        let amount = 0n;
        let destAddr: string;
        let liquidationParams: LiquidationParameters;
        if (task.loan_asset === TON_MAINNET.assetId) {
            liquidationParams = {
                borrowerAddress: Address.parse(task.wallet_address),
                loanAsset: task.loan_asset,
                collateralAsset: task.collateral_asset,
                minCollateralAmount: task.min_collateral_amount,
                liquidationAmount: task.liquidation_amount,
                tonLiquidation: true,
                queryID: task.query_id,
                liquidatorAddress: highloadAddress,
                includeUserCode: true,
                priceData,
                asset: loanAsset,
                responseAddress: highloadAddress,
                payload: Cell.EMPTY,
                payloadForwardAmount: 0n,
            };

            amount = task.liquidation_amount + FEES.LIQUIDATION;
            destAddr = getAddressFriendly(evaa.poolConfig.masterAddress);
        } else {
            const loanAsset = findAssetById(task.loan_asset, evaa.poolConfig);
            if (!loanAsset) {
                logMessage(`Liquidator: Asset ${task.loan_asset} is not supported, skipping...`);
                await bot.sendMessage(`Asset ${task.loan_asset} is not supported, skipping...`);
                continue;
            }

            liquidationParams = {
                borrowerAddress: Address.parse(task.wallet_address),
                loanAsset: task.loan_asset,
                collateralAsset: task.collateral_asset,
                minCollateralAmount: task.min_collateral_amount,
                liquidationAmount: task.liquidation_amount,
                tonLiquidation: false,
                queryID: task.query_id,
                liquidatorAddress: highloadAddress,
                includeUserCode: true,
                priceData,
                asset: loanAsset,
                responseAddress: highloadAddress,
                payload: Cell.EMPTY,
                payloadForwardAmount: 0n,
            };
            destAddr = JETTON_WALLETS.get(task.loan_asset).toString();
            amount = FEES.LIQUIDATION_JETTON;
        }

        liquidatorBalances.set(task.loan_asset, (liquidatorBalances.get(task.loan_asset) ?? 0n) - task.liquidation_amount); // actualize remaining balance
        liquidationBody = evaa.createLiquidationMessage(liquidationParams);
        highloadMessages.set(task.id, makeLiquidationCell(amount, destAddr, liquidationBody));

        await db.takeTask(task.id); // update task status to processing
        log.push({id: task.id, walletAddress: task.wallet_address}); // collection of taken tasks
    }

    if (log.length == 0) return;
    const res = await retry(
        async () => {
            const queryID = await highloadContract.sendMessages(highloadMessages, keys.secretKey);
            logMessage(`Liquidator: Highload message sent, queryID: ${queryID}`);
        }, {attempts: 20, attemptInterval: 200}
    ); // TODO: maybe add tx send watcher

    // if 20 attempts is not enough, means something is broken, maybe network, liquidator will be restarted
    if (!res) throw (`Liquidator: Failed to send highload message`);

    const logStrings: string[] = [`\nLiquidation tasks sent for ${log.length} users:`];
    for (const task of log) {
        logStrings.push(`ID: ${task.id}, Wallet: ${task.walletAddress}`);
        await db.liquidateSent(task.id);
    }
    logMessage(`Liquidator: ${logStrings.join('\n')}`);
}
