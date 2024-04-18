import {AssetID, jettonWallets} from "./config";

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getJettonWallet(assetID: bigint) {
    switch (assetID) {
        case AssetID.usdt:
            return jettonWallets.usdt
        case AssetID.usdc:
            return jettonWallets.usdc
        case AssetID.stton:
            return jettonWallets.stton
        case AssetID.tston:
            return jettonWallets.tston
    }
}