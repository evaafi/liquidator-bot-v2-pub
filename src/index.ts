import {MyDatabase} from "./db/database";
import {OpenedContract, TonClient} from "@ton/ton";
import {DB_PATH, HIGHLOAD_ADDRESS, IS_TESTNET, makeTonClient, POOL_CONFIG, TON_API_ENDPOINT} from "./config";
import axios, {AxiosInstance} from "axios";
import {handleTransactions} from "./services/indexer/indexer";
import {validateBalances} from "./services/validator/validator";
import {configDotenv} from "dotenv";
import {handleLiquidates} from "./services/liquidator/liquidator";
import {mnemonicToWalletKey} from "@ton/crypto";
import * as https from "https";
import {sleep} from "./util/process";
import {clearInterval} from "node:timers";
import {Evaa} from "@evaafi/sdk";
import {retry} from "./util/retry";
import {ChannelMessenger, logMessage, Messenger, TopicMessenger} from "./lib/messenger";
import {HighloadWalletV2} from "./lib/highload_contract_v2";

function makeTonApi(endpoint, apiKey: string) {
    const tonApi = axios.create({
        baseURL: endpoint,
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
        }),
        headers: {
            'Authorization': apiKey
        }
    });
    return tonApi;
}

async function main(bot: Messenger) {
    configDotenv();
    const poolConfig = POOL_CONFIG;
    const db = new MyDatabase(poolConfig.poolAssetsConfig);
    await db.init(DB_PATH);

    const tonApi: AxiosInstance = makeTonApi(TON_API_ENDPOINT, process.env.TONAPI_KEY);
    const tonClient: TonClient = await makeTonClient();
    const evaa: OpenedContract<Evaa> = tonClient.open(new Evaa({debug: IS_TESTNET, poolConfig}));
    const res = await retry(
        async () => await evaa.getSync(),
        {attempts: 10, attemptInterval: 5000}
    );
    if (!res.ok) throw (`Failed to sync evaa master`);

    const keys = await mnemonicToWalletKey(process.env.WALLET_PRIVATE_KEY.split(' '));
    // const highloadContract = openHighloadContract(tonClient, keys.publicKey);
    const highloadContract = new HighloadWalletV2(tonClient, HIGHLOAD_ADDRESS, keys.publicKey);

    logMessage(`Indexer is syncing...`);
    await handleTransactions(db, tonApi, tonClient, bot, evaa, HIGHLOAD_ADDRESS, true);
    logMessage(`Indexer is synced. Waiting 1 sec before starting`);

    await sleep(1000);

    let handlingTransactions = false;
    const transactionID = setInterval(async () => {
        if (handlingTransactions) {
            logMessage('Transaction Handler: handling transactions in progress, wait more...');
            return;
        }
        logMessage('Starting handleTransactions...')
        handlingTransactions = true;
        handleTransactions(db, tonApi, tonClient, bot, evaa, HIGHLOAD_ADDRESS)
            .catch(e => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    bot.sendMessage(`[Indexer]: ${e}`);
                    return;
                }
                bot.sendMessage(`[Indexer]: ${JSON.stringify(e).slice(0, 300)}`);
            })
            .finally(() => {
                handlingTransactions = false;
                logMessage("Exiting from handleTransactions...");
            });
    }, 5000);

    let validating = false;
    const validatorID = setInterval(() => {
        if (validating) {
            logMessage('Validator: validation in progress, wait more...');
            return;
        }
        validating = true;

        validateBalances(db, evaa, bot, POOL_CONFIG)
            .catch(e => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    bot.sendMessage(`[Validator]: ${e}`);
                    return;
                }
                bot.sendMessage(`[Validator]: ${JSON.stringify(e).slice(0, 300)}`);
            })
            .finally(() => {
                validating = false;
            })
    }, 5000);

    let liquidating = false;
    const liquidatorID = setInterval(() => {
        if (liquidating) {
            logMessage('Liquidator: liquidation in progress, wait more...');
            return;
        }
        liquidating = true;
        handleLiquidates(db, tonClient, highloadContract, HIGHLOAD_ADDRESS, evaa, keys, bot)
            .catch(async (e) => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    await bot.sendMessage(`[Liquidator]: ${e}`);
                    return;
                }
                await bot.sendMessage(`[Liquidator]: ${JSON.stringify(e, null, 2).slice(0, 300)}`);
            })
            .finally(async () => {
                liquidating = false;

                logMessage('Exiting from handleLiquidates...');
            });
    }, 5000);

    let blacklisting = false;
    const blacklisterID = setInterval(async () => {
        if (blacklisting) {
            logMessage('BLACKLSTER: Blacklisting is in progress, wait more...');
            return;
        }
        blacklisting = true;
        try {
            const blacklistedUsers = await db.handleFailedTasks();
            for (const user of blacklistedUsers) {
                await bot.sendMessage(`❌ User ${user} blacklisted`);
                await sleep(100);
            }
            await db.deleteOldTasks();
        } catch (e) {
            console.log(e);
        } finally {
            blacklisting = false;
            logMessage("Exiting from blacklisting...");
        }
    }, 5000);

    // handle interruption Ctrl+C === SIGINT
    let first_sigint_request = true;
    process.on('SIGINT', async () => {
        if (first_sigint_request) {
            first_sigint_request = false;
            clearInterval(transactionID);
            clearInterval(validatorID);
            clearInterval(liquidatorID);
            clearInterval(blacklisterID);

            const message = `Received SIGINT, stopping services...`;
            logMessage(message);
            await bot.sendMessage(message);

            setTimeout(() => {
                throw ('Forced exit...');
            }, 10_000);
        } else {
            throw ('Forced exit...');
        }
    });
}

(() => {
    configDotenv();

    const {TELEGRAM_BOT_TOKEN: token, SERVICE_CHAT_ID: chatId, TELEGRAM_TOPIC_ID: topicId} = process.env;
    const messenger = topicId !== undefined ?
        new TopicMessenger(token, chatId, topicId) : new ChannelMessenger(token, chatId);

    main(messenger)
        .catch(e => {
            console.log(e);
            if (JSON.stringify(e).length == 2) {
                messenger.sendMessage(`Fatal error: ${e}`).then();
                return;
            }
            messenger.sendMessage(`Fatal error: ${JSON.stringify(e).slice(0, 300)} `).then();
        })
        .finally(() => logMessage("Exiting..."));
})();
