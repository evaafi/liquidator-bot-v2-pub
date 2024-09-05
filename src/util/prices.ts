import {beginCell, Cell, Dictionary} from '@ton/core';
import {NFT_ID} from "../config";
import {retry} from "./retry";


/**
 * This file has meaning only for v5,
 * for v6 and newer versions sdk will be used for fetching prices
 */
type NftData = {
    ledgerIndex: number;
    pageSize: number;
    items: string[];
};

export type PriceData = {
    dict: Dictionary<bigint, bigint>;
    dataCell: Cell;
};


type OutputData = {
    metadata: {
        blockId: string;
        transactionId: string;
        outputIndex: number;
        isSpent: boolean;
        milestoneIndexSpent: number;
        milestoneTimestampSpent: number;
        transactionIdSpent: string;
        milestoneIndexBooked: number;
        milestoneTimestampBooked: number;
        ledgerIndex: number;
    };
    output: {
        type: number;
        amount: string;
        nftId: string;
        unlockConditions: {
            type: number;
            address: {
                type: number;
                pubKeyHash: string;
            };
        }[];
        features: {
            type: number;
            data: string;
        }[];
    };
}

export async function getPrices(endpoints: string[] = ["api.stardust-mainnet.iotaledger.net"]) {
    const result = await retry(async () => {
        return await Promise.any(endpoints.map(x => loadPrices(x)));
    }, {attempts: 3, attemptInterval: 1000});
    if (!result.ok){
        throw (`Failed to fetch prices`);
    }
    return result.value;
}

async function loadPrices(endpoint: String = "api.stardust-mainnet.iotaledger.net"): Promise<PriceData> {
    let result = await fetch(`https://${endpoint}/api/indexer/v1/outputs/nft/${NFT_ID}`, {
        headers: {accept: 'application/json'},
    });
    let outputId = (await result.json()) as NftData;

    result = await fetch(`https://${endpoint}/api/core/v2/outputs/${outputId.items[0]}`, {
        headers: {accept: 'application/json'},
    });

    let resData = (await result.json()) as OutputData;

    const data = JSON.parse(
        decodeURIComponent(resData.output.features[0].data.replace('0x', '').replace(/[0-9a-f]{2}/g, '%$&')),
    );

    const pricesCell = Cell.fromBoc(Buffer.from(data['packedPrices'], 'hex'))[0];
    const signature = Buffer.from(data['signature'], 'hex');

    return {
        dict: pricesCell.beginParse().loadDictDirect(Dictionary.Keys.BigUint(256), Dictionary.Values.BigUint(64)),
        dataCell: beginCell().storeRef(pricesCell).storeBuffer(signature).endCell(),
    };
}

export function packPrices(pricesCell: string, signature: string) {
    return beginCell()
        .storeRef(Cell.fromBase64(pricesCell))
        .storeBuffer(Buffer.from(signature, 'hex'))
        .endCell();
}
