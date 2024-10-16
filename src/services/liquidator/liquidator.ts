import {KeyPair} from "@ton/crypto";
import {Address} from "@ton/core";
import {Cell, Dictionary, OpenedContract, toNano, TonClient} from "@ton/ton";

import {Evaa, FEES, TON_MAINNET} from "@evaafi/sdkv6";
import {LiquidationParameters} from "@evaafi/sdkv6/dist/contracts/MasterContract";
import {JETTON_WALLETS, LIQUIDATION_BALANCE_LIMITS, POOL_CONFIG} from "../../config";

import {MyDatabase} from "../../db/database";
import {HighloadWalletV2, makeLiquidationCell} from "../../lib/highload_contract_v2";
import {retry} from "../../util/retry";
import {getBalances, WalletBalances} from "../../lib/balances";
import {getAddressFriendly} from "../../util/format";
import {Messenger} from "../../lib/bot";
import {formatNotEnoughBalanceMessage, Log} from "./helpers";

const MAX_TASKS_FETCH = 100;

export async function handleLiquidates(db: MyDatabase, tonClient: TonClient,
                                       highloadContract: HighloadWalletV2, highloadAddress: Address,
                                       evaa: OpenedContract<Evaa>,
                                       keys: KeyPair, bot: Messenger) {
    const evaaSyncRes = await retry(
        async () => await evaa.getSync(),
        {attempts: 10, attemptInterval: 1000}
    );
    if (!evaaSyncRes.ok) throw(`Failed to sync evaa`);

    await db.cancelOldTasks();
    const tasks = await db.getTasks(MAX_TASKS_FETCH);
    const assetIds = POOL_CONFIG.poolAssetsConfig
        .filter(asset => asset.assetId !== TON_MAINNET.assetId)
        .map(asset => asset.assetId);

    const myBalance: WalletBalances = await getBalances(tonClient, highloadAddress, assetIds, JETTON_WALLETS);
    const log: Log[] = [];
    const highloadMessages = Dictionary.empty<number, Cell>();

    for (const task of tasks) {
        const assetAmount = myBalance.get(task.loan_asset) ?? 0n;
        if (assetAmount < task.liquidation_amount) {
            if (assetAmount < LIQUIDATION_BALANCE_LIMITS.get(task.loan_asset)) {
                console.log(`Not enough balance for liquidation task ${task.id}`);
                await bot.sendMessage(formatNotEnoughBalanceMessage(task, myBalance, evaa.data.assetsConfig), {parse_mode: 'HTML'});
                await db.cancelTaskNoBalance(task.id);
                continue;
            }

            task.liquidation_amount = (task.loan_asset === TON_MAINNET.assetId) ? assetAmount - toNano(1) : assetAmount;
            task.min_collateral_amount = 0n;
        }

        const priceData = Cell.fromBase64(task.prices_cell);

        // compose liquidation body
        let liquidationBody = Cell.EMPTY;
        let amount = 0n;
        let destAddr: string;
        let liquidationParams: LiquidationParameters;
        if (task.loan_asset === TON_MAINNET.assetId) {
            const asset = POOL_CONFIG.poolAssetsConfig.find(asset => asset.name === 'TON');
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
                asset,
                responseAddress: highloadAddress,
                payload: Cell.EMPTY,
            };

            amount = task.liquidation_amount + FEES.LIQUIDATION;
            destAddr = getAddressFriendly(POOL_CONFIG.masterAddress);
        } else {
            const asset = POOL_CONFIG.poolAssetsConfig.find(
                it => it.assetId === task.loan_asset
            );
            if (!asset) {
                console.error(`Asset ${task.loan_asset} is not supported, skipping...`);
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
                priceData, asset,
                // forwardAmount: FEES.LIQUIDATION_JETTON_FWD,
                responseAddress: highloadAddress,
                payload: Cell.EMPTY,
            };
            destAddr = JETTON_WALLETS.get(task.loan_asset).toString();
            amount = FEES.LIQUIDATION_JETTON;
        }
        myBalance.set(task.loan_asset, (myBalance.get(task.loan_asset) ?? 0n) - task.liquidation_amount); // actualize remaining balance
        liquidationBody = evaa.createLiquidationMessage(liquidationParams);
        highloadMessages.set(task.id, makeLiquidationCell(amount, destAddr, liquidationBody));

        await db.takeTask(task.id); // update task status to processing
        log.push({id: task.id, walletAddress: task.wallet_address}); // collection of taken tasks
    }

    if (log.length == 0) return;
    const res = await retry(
        async () => {
            console.log('Sending highload message..');
            await highloadContract.sendMessages(highloadMessages, keys.secretKey)
        }, {attempts: 20, attemptInterval: 200}
    );
    if (!res) throw (`Failed to send highload message`);

    const logStrings: string[] = [`\nLiquidation tasks sent for ${log.length} users:`];
    for (const task of log) {
        logStrings.push(`ID: ${task.id}, Wallet: ${task.walletAddress}`);
        await db.liquidateSent(task.id);
    }
    console.log(logStrings.join('\n'));
}
