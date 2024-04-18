import { Address } from "@ton/core";
import { Cell } from "@ton/ton";
import {sha256Hash} from "./services/validator/helpers";

export const AssetID = {
    ton: sha256Hash('TON'),
    usdt: sha256Hash('jUSDT'),
    usdc: sha256Hash('jUSDC'),
    stton: sha256Hash('stTON'),
    tston: sha256Hash('tsTON')
};

//export const HIGHLOAD_CODE = Cell.fromBase64('te6ccgEBCQEA5QABFP8A9KQT9LzyyAsBAgEgAgMCAUgEBQHq8oMI1xgg0x/TP/gjqh9TILnyY+1E0NMf0z/T//QE0VNggED0Dm+hMfJgUXO68qIH+QFUEIf5EPKjAvQE0fgAf44WIYAQ9HhvpSCYAtMH1DAB+wCRMuIBs+ZbgyWhyEA0gED0Q4rmMQHIyx8Tyz/L//QAye1UCAAE0DACASAGBwAXvZznaiaGmvmOuF/8AEG+X5dqJoaY+Y6Z/p/5j6AmipEEAgegc30JjJLb/JXdHxQANCCAQPSWb6VsEiCUMFMDud4gkzM2AZJsIeKz');
//
//// ------------------ Testnet Config ------------------
//export const evaaMaster = Address.parse('kQBi2jDaq_-Oi62V7u_j_Vr1We8EqC3h0jkhB4Gf4JW741vX');
//export const rpcEndpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC'
//export const tonApiEndpoint = 'https://testnet.tonapi.io/';
//export const isTestnet = true;
//
//export const decimals = {
//    ton: 1_000_000_000n,
//    jetton: 1_000_000n,
//    dollar: 100_000_000n
//};
//
//export const jettonWallets = {
//    usdt: 'kQAj56jyNXX3MdKAbnji56rmrMNciNhf27qbfrACENw-nVtt',
//    usdc: 'kQDFMVJkWrK6yWxHzcBx3kMUVW9WOe6YsMkAlGJDFtt_YEQn',
//}
//
//export const iotaEndpoint = "https://api.stardust-mainnet.iotaledger.net";
//export const NFT_ID = "0x98f8eb12127ee205a7b84e6910021e1e65ec5c8d92f89acdffea7be20104e899"
//
//export const serviceChatID = -1001901315795;
//
//export const highloadAddress = 'kQD49DS0c3eV9MpDKludkTI4O7Vus7v6T9y_9aC25b8iCqsS';

// ------------------ Testnet Config ------------------
// export const evaaMaster = Address.parse('EQClWdMebpK90b6imEUreQJ4M3oz8Gqwd3xkVIowR8LDX2S0');
// export const rpcEndpoint = 'https://testnet.toncenter.com/api/v2/jsonRPC'
// export const tonApiEndpoint = 'https://testnet.tonapi.io/';
// export const isTestnet = true;
//
// export const decimals = {
//     ton: 1_000_000_000n,
//     jetton: 1_000_000n,
//     dollar: 100_000_000n
// };
//
// export const jettonWallets = {
//     usdt: 'kQB86FGzO_zH5w41gUqG7vbLuy4-JPTciawvLPRinfka8e6R',
//     usdc: 'kQCgh_Fs7kOqU54o1U_YI4P5w4_8q1paSkHGT7UzL2Hz5Ws0',
//     stton: 'kQACl9OYs8ld6J5OIj1h7JczJZJW5qxBxKb415fGW8ZSSSqH'
// }
//
// export const iotaEndpoint = "https://api.stardust-mainnet.iotaledger.net";
// export const NFT_ID = "0xfb9874544d76ca49c5db9cc3e5121e4c018bc8a2fb2bfe8f2a38c5b9963492f5"
//
// export const serviceChatID = -1001901315795;
//
// export const highloadAddress = 'kQD49DS0c3eV9MpDKludkTI4O7Vus7v6T9y_9aC25b8iCqsS';



// // ------------------ Mainnet Config ------------------
//
export const evaaMaster = Address.parse('EQC8rUZqR_pWV1BylWUlPNBzyiTYVoBEmQkMIQDZXICfnuRr');
export const rpcEndpoint = 'https://rpc.evaa.finance/api/v2/jsonRPC';
export const tonApiEndpoint = 'https://tonapi.io/';
export const isTestnet = false;

export const decimals = {
    ton: 1_000_000_000n,
    jetton: 1_000_000n,
    dollar: 1_000_000_000n
};

export const jettonWallets = {
    usdt: 'EQA6X8-lL4GOV8unCtzgx0HiQJovggHEniGIPGjB7RBIRR3M',
    usdc: 'EQA6mXtvihA1GG57dFCbzI1NsBlMu4iN-iSxbzN_seSlbaVM',
    stton: 'EQAw_YE5y9U3LFTPtm7peBWKz1PUg77DYlrJ3_NDyQAfab5s',
    tston: 'EQDdpsEJ2nyPP2W2yzdcM2A4FeU-IQGyxM0omo0U2Yv2DvTB'
}

export const iotaEndpoint = "https://api.stardust-mainnet.iotaledger.net";
export const NFT_ID = "0xfb9874544d76ca49c5db9cc3e5121e4c018bc8a2fb2bfe8f2a38c5b9963492f5"

export const serviceChatID = -4021802986;

export const highloadAddress = 'EQDo27P-CAam_G2xmQd4CxnFYjY2FKPmmKEc8wTCh4c33Mhi';

export const HIGHLOAD_CODE = Cell.fromBase64('te6ccgEBCQEA5QABFP8A9KQT9LzyyAsBAgEgAgMCAUgEBQHq8oMI1xgg0x/TP/gjqh9TILnyY+1E0NMf0z/T//QE0VNggED0Dm+hMfJgUXO68qIH+QFUEIf5EPKjAvQE0fgAf44WIYAQ9HhvpSCYAtMH1DAB+wCRMuIBs+ZbgyWhyEA0gED0Q4rmMQHIyx8Tyz/L//QAye1UCAAE0DACASAGBwAXvZznaiaGmvmOuF/8AEG+X5dqJoaY+Y6Z/p/5j6AmipEEAgegc30JjJLb/JXdHxQANCCAQPSWb6VsEiCUMFMDud4gkzM2AZJsIeKz');

