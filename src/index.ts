import { MyDatabase } from "./db/database";
import { Address, beginCell, TonClient, WalletContractV4 } from "@ton/ton";
import { HIGHLOAD_CODE, highloadAddress, iotaEndpoint, rpcEndpoint, serviceChatID, tonApiEndpoint } from "./config";
import axios from "axios";
import { Client } from "@iota/sdk";
import { handleTransactions } from "./services/indexer/indexer";
import { validateBalances } from "./services/validator/validator";
import { configDotenv } from "dotenv";
import { handleLiquidates } from "./services/liquidator";
import { mnemonicToWalletKey } from "@ton/crypto";
import { Bot } from "grammy";
import * as https from "https";
import { sleep } from "./helpers";

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
    //mainnet
    const tonClient = new TonClient({
        endpoint: rpcEndpoint,
        apiKey: process.env.RPC_API_KEY
    });
    const iotaClient = new Client({
        nodes: [iotaEndpoint],
    });
    const keys = await mnemonicToWalletKey(process.env.WALLET_PRIVATE_KEY.split(' '));
    const wallet = WalletContractV4.create({
        workchain: 0,
        publicKey: keys.publicKey
    });
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
    console.log(`Indexer is synced. Waiting 5 sec before starting`);

    await sleep(5000);
    console.log('Starting handleTransactions...')
    handleTransactions(db, tonApi, tonClient, bot, Address.parse(highloadAddress))
        .catch(e => {
            console.log(e);
            if (JSON.stringify(e).length == 2) {
                bot.api.sendMessage(serviceChatID, `[Indexer]: ${e}`);
                return;
            }
            bot.api.sendMessage(serviceChatID, `[Indexer]: ${JSON.stringify(e).slice(0, 300)}`);
        })
        .finally(() => console.log("Exiting from handleTransactions..."));

    const validatorID = setInterval(() => {
        validateBalances(db, tonClient, iotaClient)
            .catch(e => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    bot.api.sendMessage(serviceChatID, `[Validator]: ${e}`);
                    return;
                }
                bot.api.sendMessage(serviceChatID, `[Validator]: ${JSON.stringify(e).slice(0, 300)}`);
            })
    }, 5000);
    const liquidatorID = setInterval(() => {
        handleLiquidates(db, tonClient, contract, Address.parse(highloadAddress), keys, bot)
            .catch(async (e) => {
                console.log(e);
                if (JSON.stringify(e).length == 2) {
                    await bot.api.sendMessage(serviceChatID, `[Liquidator]: ${e}`);
                    return;
                }
                await bot.api.sendMessage(serviceChatID, `[Liquidator]: ${JSON.stringify(e, null, 2).slice(0, 300)}`);
            })
    }, 10000);

    setInterval(async () => {
        const blacklistedUsers = await db.handleFailedTasks();
        for (const user of blacklistedUsers) {
            await bot.api.sendMessage(serviceChatID, `❌ User ${user} blacklisted`);
            await sleep(100);
        }

        await db.deleteOldTasks();
    }, 15000);
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
