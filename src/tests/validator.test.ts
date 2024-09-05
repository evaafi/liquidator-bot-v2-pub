import {beforeEach, describe, it} from "node:test";
import {beginCell, Dictionary, DictionaryValue, Slice} from "@ton/ton";
import {selectCollateral} from "../services/validator/validator";
import {AssetID} from "../config";
import {expect} from "chai";

type MockAssetData = {
    sRate: bigint,
    bRate: bigint,
}

type MockAssetConfig = {
    decimals: bigint,
    liquidationThreshold: bigint
};

export function createAssetConfig(): DictionaryValue<MockAssetConfig> {
    return {
        serialize: (src: any, builder: any) => {
            builder.storeUint(src.decimals, 8);
            const refBuild = beginCell();
            refBuild.storeUint(src.liquidationThreshold, 16);
            builder.storeRef(refBuild.endCell());
        },
        parse: (src: Slice) => {
            const decimals = BigInt(src.loadUint(8));
            const ref = src.loadRef().beginParse();
            const liquidationThreshold = ref.loadUintBig(16);

            return {
                decimals,
                liquidationThreshold,
            };
        },
    };
}

export function createAssetData(): DictionaryValue<MockAssetData> {
    return {
        serialize: (src: any, buidler: any) => {
            buidler.storeUint(src.sRate, 64);
            buidler.storeUint(src.bRate, 64);
        },
        parse: (src: Slice) => {
            const sRate = BigInt(src.loadInt(64));
            const bRate = BigInt(src.loadInt(64));

            return {
                sRate, bRate
            };
        },
    };
}

/*  Priority:
    [AssetID.ton, 2],
    [AssetID.stton, 3],
    [AssetID.jusdt, 4],
    [AssetID.jusdc, 6],
 */

type PrincipalsDict = Dictionary<bigint, bigint>;
type PricesDict = Dictionary<bigint, bigint>;
type AssetConfigDict = Dictionary<bigint, MockAssetConfig>;
type AssetDataDict = Dictionary<bigint, MockAssetData>;

const makeEmptyPrices = () => Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.BigUint(64));
const makeEmptyPrincipals = makeEmptyPrices;
const makeEmptyConfigs = () => Dictionary.empty(Dictionary.Keys.BigUint(256), createAssetConfig());
const makeEmptyDynamics = () => Dictionary.empty(Dictionary.Keys.BigUint(256), createAssetData());

function makeMockPrincipals_select_TON(): PrincipalsDict {
    let dict = makeEmptyPrincipals();
    dict.set(AssetID.TON, 123_000_000n);     // to select
    dict.set(AssetID.stTON, 99_000_000n);    // not participating
    dict.set(AssetID.jUSDT, 101_000_000n);   // maybe next time
    dict.set(AssetID.jUSDC, -99_000_000n)    // loan
    return dict;
}

function makeMockPrincipals_select_jUSDT(): PrincipalsDict {
    let dict = makeEmptyPrincipals();
    dict.set(AssetID.TON, 18_000_000n);     // not participating
    dict.set(AssetID.stTON, 19_000_000n);   // not participating
    dict.set(AssetID.jUSDT, 125_000_000n);  // to select
    dict.set(AssetID.jUSDC, -99_000_000n);  // loan
    return dict;
}

function makeMockPrincipals_oldLogic_stTON(): PrincipalsDict {
    let dict = makeEmptyPrincipals();
    dict.set(AssetID.TON, 98_000_000n);     // not participating
    dict.set(AssetID.stTON, 99_000_000n);   // to select
    dict.set(AssetID.jUSDT, 97_000_000n);  // not participating
    dict.set(AssetID.jUSDC, -99_000_000n);  // loan
    return dict;
}

function makeMockPrices(): PricesDict {
    let dict = makeEmptyPrices();
    dict.set(AssetID.TON, 5_000_000_000n);
    dict.set(AssetID.stTON, 5_000_000_000n);
    dict.set(AssetID.jUSDT, 1_000_000_000n);
    dict.set(AssetID.jUSDC, 1_000_000_000n);
    return dict;
}

function makeMockConfig(): AssetConfigDict {
    let configs = makeEmptyConfigs();
    const item = {decimals: 9n, liquidationThreshold: 7500n};
    configs.set(AssetID.TON, item);
    configs.set(AssetID.stTON, item);
    configs.set(AssetID.jUSDT, item);
    configs.set(AssetID.jUSDC, item);
    return configs;
}

function makeMockDynamics(): AssetDataDict {
    const data = makeEmptyDynamics();
    const item = {sRate: 800_000_000_000n, bRate: 800_000_000_000n};
    data.set(AssetID.TON, item);
    data.set(AssetID.stTON, item);
    data.set(AssetID.jUSDT, item);
    data.set(AssetID.jUSDC, item);
    return data;
}

describe('Select collateral tests', () => {
    let prices: PricesDict;
    let config: AssetConfigDict;
    let dynamics: AssetDataDict;
    let principals: PrincipalsDict;

    beforeEach(() => {
        prices = makeMockPrices();
        config = makeMockConfig();
        dynamics = makeMockDynamics();
        // console.log('Config: ', config);
        // console.log('Dynamics: ', dynamics);
    })
    it('Should select TON', async () => {
        principals = makeMockPrincipals_select_TON();

        const {
            gCollateralValue,
            gCollateralAsset,
            gLoanValue,
            gLoanAsset,
            totalDebt,
            totalLimit,
        } = selectCollateral(principals, prices, config, dynamics);

        expect(gCollateralAsset).to.eq(AssetID.TON);
        expect(gLoanAsset).to.eq(AssetID.jUSDC);
        // expect(totalDebt).to.eq(99_000_000n * 8n / 10n);
        expect(totalDebt).to.eq(-principals.get(gLoanAsset) * dynamics.get(gLoanAsset).bRate / BigInt(1e12));
    })
    it('Should select jUSDT', async () => {
        console.log("START TEST");
        const principals = makeMockPrincipals_select_jUSDT();
        const {
            gCollateralValue,
            gCollateralAsset,
            gLoanValue,
            gLoanAsset,
            totalDebt,
            totalLimit,
        } = selectCollateral(principals, prices, config, dynamics);

        expect(gCollateralAsset).to.eq(AssetID.jUSDT);
        expect(gLoanAsset).to.eq(AssetID.jUSDC);
        expect(totalDebt).to.eq(-principals.get(gLoanAsset) * dynamics.get(gLoanAsset).bRate / BigInt(1e12));
    })
    it('Should select old logic', async () => {
        const principals = makeMockPrincipals_oldLogic_stTON();

        const {
            gCollateralValue,
            gCollateralAsset,
            gLoanValue,
            gLoanAsset,
            totalDebt,
            totalLimit,
        } = selectCollateral(principals, prices, config, dynamics);

        expect(gCollateralAsset).to.eq(AssetID.stTON);
        expect(gLoanAsset).to.eq(AssetID.jUSDC);
        expect(totalDebt).to.eq(-principals.get(gLoanAsset) * dynamics.get(gLoanAsset).bRate / BigInt(1e12));
    })
})
