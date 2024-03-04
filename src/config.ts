import { Address } from "@ton/core";
import { Cell } from "@ton/ton";
import {sha256Hash} from "./services/validator/helpers";

export const AssetID = {
    ton: sha256Hash('TON'),
    usdt: sha256Hash('jUSDT'),
    usdc: sha256Hash('jUSDC'),
};

// // ------------------ Mainnet Config ------------------
export const evaaMaster = Address.parse('EQC8rUZqR_pWV1BylWUlPNBzyiTYVoBEmQkMIQDZXICfnuRr');

export const rpcEndpoint = '';
export const tonApiEndpoint = '';
export const isTestnet = false;

export const decimals = {
    ton: 1_000_000_000n,
    jetton: 1_000_000n,
    dollar: 100_000_000n
};

export const jettonWallets = {
    usdt: 'EQA6X8-lL4GOV8unCtzgx0HiQJovggHEniGIPGjB7RBIRR3M',
    usdc: 'EQA6mXtvihA1GG57dFCbzI1NsBlMu4iN-iSxbzN_seSlbaVM',
}

export const iotaEndpoint = "https://api.stardust-mainnet.iotaledger.net";
export const NFT_ID = "0xfb9874544d76ca49c5db9cc3e5121e4c018bc8a2fb2bfe8f2a38c5b9963492f5"

export const serviceChatID = ;

export const highloadAddress = '';

export const HIGHLOAD_CODE = Cell.fromBase64('te6ccgEBCQEA5QABFP8A9KQT9LzyyAsBAgEgAgMCAUgEBQHq8oMI1xgg0x/TP/gjqh9TILnyY+1E0NMf0z/T//QE0VNggED0Dm+hMfJgUXO68qIH+QFUEIf5EPKjAvQE0fgAf44WIYAQ9HhvpSCYAtMH1DAB+wCRMuIBs+ZbgyWhyEA0gED0Q4rmMQHIyx8Tyz/L//QAye1UCAAE0DACASAGBwAXvZznaiaGmvmOuF/8AEG+X5dqJoaY+Y6Z/p/5j6AmipEEAgegc30JjJLb/JXdHxQANCCAQPSWb6VsEiCUMFMDud4gkzM2AZJsIeKz');

