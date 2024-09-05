import {AssetID, jettonWallets} from "./config";

export function getJettonWallet(assetID: bigint) {
    switch (assetID) {
        case AssetID.jUSDT: return jettonWallets.jUSDT;
        case AssetID.jUSDC: return jettonWallets.jUSDC;
        case AssetID.stTON: return jettonWallets.stTON;
        case AssetID.tsTON: return jettonWallets.tsTON;
        case AssetID.USDT: return jettonWallets.USDT;
        // case AssetID.TONUSDT_DEDUST: return jettonWallets.TONUSDT_DEDUST;
        // case AssetID.TONUSDT_STONFI: return jettonWallets.TONUSDT_STONFI;
        // case AssetID.TON_STORM: return jettonWallets.TON_STORM;
        // case AssetID.USDT_STORM: return jettonWallets.USDT_STORM;
        default: break;
    }
    throw (`Unsupported asset id`);
}