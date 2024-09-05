import {Address} from "@ton/core";
import {Cell} from "@ton/ton";

import {sha256Hash} from "./util/crypto";

export const AssetID = {
    TON:            sha256Hash('TON'),
    USDT:           sha256Hash('USDT'),
    jUSDT:          sha256Hash('jUSDT'),
    jUSDC:          sha256Hash('jUSDC'),
    stTON:          sha256Hash('stTON'),
    tsTON:          sha256Hash('tsTON'),
    TONUSDT_DEDUST: sha256Hash('TONUSDT_DEDUST'),
    TONUSDT_STONFI: sha256Hash('TONUSDT_STONFI'),
    TON_STORM:      sha256Hash('TON_STORM'),
    USDT_STORM:     sha256Hash('USDT_STORM'),
    time:           sha256Hash('time'),
};

export const AssetDecimals = {
    TON:            1_000_000_000n, // 9
    USDT:           1_000_000n,     // 6
    jUSDT:          1_000_000n,     // 6
    jUSDC:          1_000_000n,     // 6
    tsTON:          1_000_000_000n, // 9
    stTON:          1_000_000_000n, // 9
    TONUSDT_DEDUST: 1_000_000_000n, // 9
    TONUSDT_STONFI: 1_000_000_000n, // 9
    TON_STORM:      1_000_000_000n, // 9
    USDT_STORM:     1_000_000_000n, // 9
};

export const CollateralSelectPriorities = new Map<bigint, number>([
    [AssetID.USDT,              1],
    [AssetID.TON,               2],
    [AssetID.stTON,             3],
    [AssetID.jUSDT,             4],
    [AssetID.tsTON,             5],
    [AssetID.jUSDC,             6],
    [AssetID.TONUSDT_DEDUST,    7],
    [AssetID.TONUSDT_STONFI,    8],
    [AssetID.TON_STORM,         9],
    [AssetID.USDT_STORM,        10],
]);

// ------------------ Mainnet Config ------------------

export const isTestnet = false;

export const jettonWallets = {
    jUSDT: 'EQA6X8-lL4GOV8unCtzgx0HiQJovggHEniGIPGjB7RBIRR3M',
    jUSDC: 'EQA6mXtvihA1GG57dFCbzI1NsBlMu4iN-iSxbzN_seSlbaVM',
    stTON: 'EQAw_YE5y9U3LFTPtm7peBWKz1PUg77DYlrJ3_NDyQAfab5s',
    tsTON: 'EQDdpsEJ2nyPP2W2yzdcM2A4FeU-IQGyxM0omo0U2Yv2DvTB',
    USDT: 'EQC183ELZmTbdsfRtPmp-SzyRXf0UOV3pdNNwtX2P98z2pQM',
    // // for LP-pool version
    // TONUSDT_DEDUST: 'EQD1msA18OaAzYPAVrFKfbxHCl1kxQkzsY7zolgtwAqgUuMP',
    // TONUSDT_STONFI: 'EQAoXoKRiIx8SDXBXKUHJXfGYXi98a7Pr0UzMOSLz4gely2Z',
    // TON_STORM: 'EQChlnD11dNt5QpiykF_WMniq8WfsQ8I4n2aFhfknU5eOfbP',
    // USDT_STORM: 'EQAQnMn2bCY1BcTVqawdblFMh3yw5kkJqiHi52ey-gbL6ofM',
}

export const NFT_ID = "0xfb9874544d76ca49c5db9cc3e5121e4c018bc8a2fb2bfe8f2a38c5b9963492f5"
export const evaaMaster = Address.parse('EQC8rUZqR_pWV1BylWUlPNBzyiTYVoBEmQkMIQDZXICfnuRr');
export const rpcEndpoint = 'https://rpc.evaa.finance/api/v2/jsonRPC';
export const tonApiEndpoint = 'https://tonapi.io/';

export const serviceChatID = -4021802986;
export const highloadAddress = 'EQDo27P-CAam_G2xmQd4CxnFYjY2FKPmmKEc8wTCh4c33Mhi';

export const HIGHLOAD_CODE = Cell.fromBase64('te6ccgEBCQEA5QABFP8A9KQT9LzyyAsBAgEgAgMCAUgEBQHq8oMI1xgg0x/TP/gjqh9TILnyY+1E0NMf0z/T//QE0VNggED0Dm+hMfJgUXO68qIH+QFUEIf5EPKjAvQE0fgAf44WIYAQ9HhvpSCYAtMH1DAB+wCRMuIBs+ZbgyWhyEA0gED0Q4rmMQHIyx8Tyz/L//QAye1UCAAE0DACASAGBwAXvZznaiaGmvmOuF/8AEG+X5dqJoaY+Y6Z/p/5j6AmipEEAgegc30JjJLb/JXdHxQANCCAQPSWb6VsEiCUMFMDud4gkzM2AZJsIeKz');

// assets banned from being swapped from
export const BANNED_ASSETS_FROM = [
    AssetID.tsTON,
    AssetID.jUSDC
];
// assets banned from being swapped to
export const BANNED_ASSETS_TO = [
    AssetID.tsTON,
    AssetID.jUSDC
];
//  lower bound of asset worth to swap
export const PRICE_ACCURACY = 1_000_000_000n;   // 10**9
export const MIN_WORTH_SWAP_LIMIT: bigint = 100n * PRICE_ACCURACY; // usd
