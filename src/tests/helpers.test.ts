import {AssetID, MIN_WORTH_SWAP_LIMIT} from '../config';
import {
    checkEligibleSwapTask,
    getAssetDecimals,
    getAssetName,
    isBannedSwapFrom,
    isBannedSwapTo,
    getFriendlyAmount
} from '../services/indexer/helpers';
import {describe, it} from 'node:test';
import {expect} from 'chai';
import {getPrices} from '../util/prices';

describe('Simple tests', () => {
    it('check assets banned from/to swap', () => {
        const bannedIds = [AssetID.tsTON, AssetID.jUSDC];
        bannedIds.forEach(assetId => {
            expect(isBannedSwapFrom(assetId)).to.be.true;
            expect(isBannedSwapTo(assetId)).to.be.true;
        })
    })
    it('check assets decimals', () => {
        const six_decimals = [AssetID.USDT, AssetID.jUSDT, AssetID.jUSDC];
        const nine_decimals = [AssetID.TON, AssetID.tsTON, AssetID.stTON];
        six_decimals.forEach(assetId => {
            expect(getAssetDecimals(assetId)).to.be.eq(1_000_000n);
        })
        nine_decimals.forEach(assetId => {
            expect(getAssetDecimals(assetId)).to.be.eq(1_000_000_000n);
        })
    })
    it('check get asset name', () => {
        expect(getAssetName(AssetID.TON)).to.eq('TON');
        expect(getAssetName(AssetID.tsTON)).to.eq('tsTON');
        expect(getAssetName(AssetID.stTON)).to.eq('stTON');
        expect(getAssetName(AssetID.USDT)).to.eq('USDT');
        expect(getAssetName(AssetID.jUSDT)).to.eq('jUSDT');
        expect(getAssetName(AssetID.jUSDC)).to.eq('jUSDC');
        expect(getAssetName(AssetID.TONUSDT_DEDUST)).to.eq('TONUSDT_DEDUST');
        expect(getAssetName(AssetID.TONUSDT_STONFI)).to.eq('TONUSDT_STONFI');
        expect(getAssetName(AssetID.TON_STORM)).to.eq('TON_STORM');
        expect(getAssetName(AssetID.USDT_STORM)).to.eq('USDT_STORM');
    })
    it('check checkEligibleSwapTask function', async () => {
        const {dict: prices} = await getPrices();

        expect(prices, 'Failed to obtain prices from middleware!').not.to.eq(undefined);
        const assetFrom = AssetID.TON;
        const assetTo = AssetID.USDT;

        const PRICE_PRECISION = 1_000_000_000n;
        const assetPrice = prices.get(assetFrom);
        const assetAmountBase = MIN_WORTH_SWAP_LIMIT * PRICE_PRECISION / assetPrice;
        const assetAmountGood = assetAmountBase * 101n / 100n;
        const assetAmountBad = assetAmountBase * 99n / 100n;

        expect(await checkEligibleSwapTask(assetFrom, assetAmountBad, assetTo)).to.be.false;
        expect(await checkEligibleSwapTask(assetFrom, assetAmountGood, assetTo)).to.be.true;
    })
    it('check getFriendlyAmount', ()=>{
        // console.log('TON: ', getFriendlyAmount(1_000_000_00n, 'TON'));
        expect(getFriendlyAmount(100_000_000n, 'TON')).to.eq('0.10 TON');
        expect(getFriendlyAmount(100_000_000n, 'tsTON')).to.eq('0.10 tsTON');
        expect(getFriendlyAmount(100_000_000n, 'stTON')).to.eq('0.10 stTON');
        expect(getFriendlyAmount(100_000n, 'USDT')).to.eq('0.10 USDT');
        expect(getFriendlyAmount(100_000n, 'jUSDT')).to.eq('0.10 jUSDT');
        expect(getFriendlyAmount(100_000n, 'jUSDC')).to.eq('0.10 jUSDC');

        expect(getFriendlyAmount(100_000_000n, 'TONUSDT_DEDUST')).to.eq('0.10 TONUSDT_DEDUST');
        expect(getFriendlyAmount(100_000_000n, 'TONUSDT_STONFI')).to.eq('0.10 TONUSDT_STONFI');
        expect(getFriendlyAmount(100_000_000n, 'TON_STORM')).to.eq('0.10 TON_STORM');
        expect(getFriendlyAmount(100_000_000n, 'USDT_STORM')).to.eq('0.10 USDT_STORM');
    })
});
