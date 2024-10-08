import { beginCell, Cell, Dictionary } from '@ton/core';
import { ethers } from 'ethers';
import sortDeepObjectArrays from 'sort-deep-object-arrays';
import {AssetID} from "../../config";
import {PriceData} from "./types";

type PricePackage = {
    prices: {
        symbol: string;
        value: number;
    }[];
    timestamp: number;
};

type SerializedPricePackage = {
    symbols: string[];
    values: string[];
    timestamp: number;
};

function hexToArrayBuffer(input: any) {
    if (typeof input !== 'string') {
        throw new TypeError('Expected input to be a string');
    }
    if (input.length % 2 !== 0) {
        throw new RangeError('Expected string to be an even number of characters');
    }

    if (input.startsWith('0x')) {
        input = input.slice(2);
    }
    const view = new Uint8Array(input.length / 2);
    for (let i = 0; i < input.length; i += 2) {
        view[i / 2] = parseInt(input.substring(i, i + 2), 16);
    }
    return Buffer.from(view.buffer);
}

function convertStringToBytes32String(str: string) {
    if (str.length > 31) {
        const bytes32StringLength = 32 * 2 + 2; // 32 bytes (each byte uses 2 symbols) + 0x
        if (str.length === bytes32StringLength && str.startsWith('0x')) {
            return str;
        } else {
            return ethers.utils.id(str);
        }
    } else {
        return ethers.utils.formatBytes32String(str);
    }
}

function sortDeepObjects<T>(arr: T[]): T[] {
    return sortDeepObjectArrays(arr);
}

function serializeToMessage(pricePackage: PricePackage): SerializedPricePackage {
    const cleanPricesData = pricePackage.prices.map((p: any) => ({
        symbol: convertStringToBytes32String(p.symbol),
        value: Math.round(p.value * 10 ** 8),
    }));
    const sortedPrices = sortDeepObjects(cleanPricesData);
    const symbols: string[] = [];
    const values: string[] = [];
    sortedPrices.forEach((p: any) => {
        symbols.push(p.symbol);
        values.push(p.value);
    });

    return {
        symbols,
        values,
        timestamp: pricePackage.timestamp,
    };
}
function getLiteDataBytesString(priceData: any): string {
    let data = '';
    for (let i = 0; i < priceData.symbols.length; i++) {
        const symbol = priceData.symbols[i];
        const value = priceData.values[i];
        data += symbol.substr(2) + value.toString(16).padStart(64, '0');
    }
    data += Math.ceil(priceData.timestamp / 1000)
        .toString(16)
        .padStart(64, '0');
    return data;
}
