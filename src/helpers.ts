import {AssetID, jettonWallets} from "./config";

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getJettonWallet(assetID: bigint) {
    switch (assetID) {
        case AssetID.jusdt:
            return jettonWallets.jusdt
        case AssetID.jusdc:
            return jettonWallets.jusdc
        case AssetID.stton:
            return jettonWallets.stton
        case AssetID.tston:
            return jettonWallets.tston
        case AssetID.usdt:
            return jettonWallets.usdt
    }
}