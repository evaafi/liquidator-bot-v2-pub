import {beforeEach, describe, it} from "node:test";
import {getPrices} from '../util/prices';
import {beginCell, TonClient} from "@ton/ton";
import {rpcEndpoint} from "../config";
import {sign} from "@ton/crypto";
import * as bip39 from 'bip39';
import {expect} from "chai";


describe('Simple tests', () => {
    let evaa;
    let priceData;
    let liquidateAddr; // user to liquidate
    let sender; // bot
    let client;

    beforeEach(async () => {
        client = new TonClient({
            endpoint: rpcEndpoint,
            apiKey: process.env.TONCENTER_API_KEY
        });
    });

    it('Check signature size', () => {
        const toSign = beginCell().storeUint(12345, 64).endCell();
        const mnemonic = bip39.generateMnemonic();
        console.log(mnemonic);
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const secretKey = seed.toString('hex');
        console.log('secretKey: ', secretKey);
        const signature = sign(toSign.hash(), seed);
        console.log(`Signature bits: ${signature.length * 8}: Signature: ${signature}`);
        expect(signature.length).to.eq(64);
    })

    it('Test getPrices()', async () => {
        priceData = await getPrices();
        // console.log(priceData);
        const {dict: prices, dataCell} = priceData;
        console.log('PRICES: ', prices);

        console.log('DataCell: ', dataCell);
        const dataSlice = dataCell.beginParse();
        console.log('Num refs: ', dataCell.refs.length);

        const ref = dataSlice.loadRef();
        console.log('REF: ', ref);

        console.log('REMAINING BITS: ', dataSlice.remainingBits);
        // 512 bits should remain
        expect(dataSlice.remainingBits).to.eq(512);
        // loadBuffer() takes size in bytes, not bits, so 512 / 8 === 64
        const buffer = dataSlice.loadBuffer(64);
        console.log('BUFFER: ', buffer);
    });

    it.skip('Liquidate test', async () => {
        await evaa.getSync();
        priceData = await getPrices();

        let user = client.open(await evaa.openUserContract(liquidateAddr));
        await user.getSync(evaa.data!.assetsData, evaa.data!.assetsConfig, priceData.dict);


        if (user.data?.type != "active" || !user.isLiquidable) {
            console.log('userInactive')
            return;
        }
    })
});
