import {Address} from "@ton/core";
import {ASSET_ID} from "./steady_config";
import {TonClient} from "@ton/ton";
import {configDotenv} from "dotenv";
import {MAINNET_LP_POOL_CONFIG, MAINNET_POOL_CONFIG} from "@evaafi/sdk";

export const HIGHLOAD_ADDRESS = Address.parse('EQDo27P-CAam_G2xmQd4CxnFYjY2FKPmmKEc8wTCh4c33Mhi');
// jetton wallets of specified highloadAddress
export const JETTON_WALLETS = new Map<bigint, Address>([
    [ASSET_ID.jUSDT, Address.parse('EQA6X8-lL4GOV8unCtzgx0HiQJovggHEniGIPGjB7RBIRR3M')],
    [ASSET_ID.jUSDC, Address.parse('EQA6mXtvihA1GG57dFCbzI1NsBlMu4iN-iSxbzN_seSlbaVM')],
    [ASSET_ID.stTON, Address.parse('EQAw_YE5y9U3LFTPtm7peBWKz1PUg77DYlrJ3_NDyQAfab5s')],
    [ASSET_ID.tsTON, Address.parse('EQDdpsEJ2nyPP2W2yzdcM2A4FeU-IQGyxM0omo0U2Yv2DvTB')],
    [ASSET_ID.USDT, Address.parse('EQC183ELZmTbdsfRtPmp-SzyRXf0UOV3pdNNwtX2P98z2pQM')],
    // LP-jwallets
    [ASSET_ID.TONUSDT_DEDUST, Address.parse('EQD1msA18OaAzYPAVrFKfbxHCl1kxQkzsY7zolgtwAqgUuMP')],
    [ASSET_ID.TONUSDT_STONFI, Address.parse('EQAoXoKRiIx8SDXBXKUHJXfGYXi98a7Pr0UzMOSLz4gely2Z')],
    [ASSET_ID.TON_STORM, Address.parse('EQChlnD11dNt5QpiykF_WMniq8WfsQ8I4n2aFhfknU5eOfbP')],
    [ASSET_ID.USDT_STORM, Address.parse('EQAQnMn2bCY1BcTVqawdblFMh3yw5kkJqiHi52ey-gbL6ofM')],
]);

export const IS_TESTNET = false;
const dbPathMainnet = './database-mainnet.db';
const dbPathTestnet = './database-testnet.db';
export const DB_PATH = IS_TESTNET ? dbPathTestnet : dbPathMainnet
/* Actual configuration */
export const RPC_ENDPOINT = 'https://rpc.evaa.finance/api/v2/jsonRPC';
export const TON_API_ENDPOINT = 'https://tonapi.io/';

export async function makeTonClient() {
    configDotenv();
    const tonClient = new TonClient({
        endpoint: RPC_ENDPOINT,
        apiKey: process.env.TONCENTER_API_KEY
    });
    return tonClient;
}

export const USER_UPDATE_DELAY = 60_000; // 60 seconds
export const TX_PROCESS_DELAY = 40; // ms
export const RPC_CALL_DELAY = 20; // ms

// export const POOL_CONFIG = MAINNET_LP_POOL_CONFIG; 
export const POOL_CONFIG = MAINNET_POOL_CONFIG;
