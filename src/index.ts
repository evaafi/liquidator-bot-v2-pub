import {MyDatabase} from "./db/database";
import {Address, beginCell, TonClient} from "@ton/ton";
import {HIGHLOAD_CODE, highloadAddress, rpcEndpoint, serviceChatID, tonApiEndpoint} from "./config";
import axios from "axios";
import {handleTransactions} from "./services/indexer/indexer";
import {validateBalances} from "./services/validator/validator";
import {configDotenv} from "dotenv";
import {handleLiquidates} from "./services/liquidator";
import {mnemonicToWalletKey} from "@ton/crypto";
import {Bot} from "grammy";
import * as https from "https";
import {sleep} from "./util/common";
import {clearInterval} from "node:timers";

async function main(bot: Bot) {
    configDotenv();
    const db = new MyDatabase();
    await db.init();

    const tonApi = axios.create({
        baseURL: tonApiEndpoint,
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
        }),
        headers: {
            'Authorization': process.env.TONAPI_KEY
        }
    });

    const tonClient = new TonClient({
        endpoint: rpcEndpoint,
        apiKey: process.env.TONCENTER_API_KEY
    });
    const keys = await mnemonicToWalletKey(process.env.WALLET_PRIVATE_KEY.split(' '));
    const contract = tonClient.provider(Address.parse(highloadAddress), {
        code: HIGHLOAD_CODE,
        data: beginCell()
            .storeUint(698983191, 32)
            .storeUint(0, 64)
            .storeBuffer(keys.publicKey)
            .storeBit(0)
            .endCell()
    });

    console.log(`Indexer is syncing...`);
    await handleTransactions(db, tonApi, tonClient, bot, Address.parse(highloadAddress), true);
    console.log(`Indexer is synced. Waiting 1 sec before starting`);

    await sleep(1000);

    let handlingTransactions = false;
    const transactionID = setInterval(async () => {
        if (handlingTransactions) {
            console.log("[TransactionHandler]:", 'handling transactions in progress, wait more...');
            return;
        }
        console.log('Starting handleTransactions...')
        handlingTransactions = true;
        handleTransactions(db, tonApi, tonClient, bot, Address.parse(highloadAddress))
            .catch(e => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    bot.api.sendMessage(serviceChatID, `[Indexer]: ${e}`);
                    return;
                }
                bot.api.sendMessage(serviceChatID, `[Indexer]: ${JSON.stringify(e).slice(0, 300)}`);
            })
            .finally(() => {
                handlingTransactions = false;
                console.log("Exiting from handleTransactions...");
                bot.api.sendMessage(serviceChatID, `Exiting from handleTransactions`).catch((e) => {
                    console.log('bot error in handle finally: ');
                    console.log(e);
                });
            });
    }, 5000);

    let validating = false;
    const validatorID = setInterval(() => {
        if (validating) {
            console.log("[Validator]:", 'validation in progress, wait more...');
            return;
        }
        validating = true;

        validateBalances(db, tonClient, bot)
            .catch(e => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    bot.api.sendMessage(serviceChatID, `[Validator]: ${e}`);
                    return;
                }
                bot.api.sendMessage(serviceChatID, `[Validator]: ${JSON.stringify(e).slice(0, 300)}`);
            })
            .finally(() => {
                validating = false;
            })
    }, 5000);

    let liquidating = false;
    const liquidatorID = setInterval(() => {
        if (liquidating) {
            console.log("[Liquidator]:", 'liquidation in progress, wait more...');
            return;
        }
        liquidating = true;
        handleLiquidates(db, tonClient, contract, Address.parse(highloadAddress), keys, bot)
            .catch(async (e) => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    await bot.api.sendMessage(serviceChatID, `[Liquidator]: ${e}`);
                    return;
                }
                await bot.api.sendMessage(serviceChatID, `[Liquidator]: ${JSON.stringify(e, null, 2).slice(0, 300)}`);
            })
            .finally(async () => {
                liquidating = false;
                console.log("Exiting from handleLiquidates...");
            });
    }, 5000);

    let blacklisting = false;
    const blacklisterID = setInterval(async () => {
        if (blacklisting) {
            console.log("[Blacklister]:", "Blacklisting is in progress, wait more...");
            return;
        }
        blacklisting = true;
        try {
            const blacklistedUsers = await db.handleFailedTasks();
            for (const user of blacklistedUsers) {
                await bot.api.sendMessage(serviceChatID, `❌ User ${user} blacklisted`);
                await sleep(100);
            }
            await db.deleteOldTasks();
        } catch (e) {
            console.log(e);
        } finally {
            blacklisting = false;
            console.log("Exiting from blacklisting...");
        }
    }, 5000);

    // handle interruption Ctrl+C === SIGINT
    process.on('SIGINT', async () => {
        clearInterval(transactionID);
        clearInterval(validatorID);
        clearInterval(liquidatorID);
        clearInterval(blacklisterID);

        const message = `Received SIGINT, stopping services...`;
        console.log(message);
        await bot.api.sendMessage(serviceChatID, message);

        setTimeout(()=> {
            throw ('Forced exit...');
        }, 10_000);
    });
}

(() => {
    configDotenv();
    const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    main(bot)
        .catch(e => {
            console.log(e);
            if (JSON.stringify(e).length == 2) {
                bot.api.sendMessage(serviceChatID, `Fatal error: ${e}`);
                return;
            }
            bot.api.sendMessage(serviceChatID, `Fatal error: ${JSON.stringify(e).slice(0, 300)} `);
        })
        .finally(() => console.log("Exiting..."));
})()
