import { Cell, Dictionary, TonClient } from "@ton/ton";
import { Client, MetadataFeature, NftOutput, hexToUtf8 } from "@iota/sdk";
import { AssetID, decimals, evaaMaster, NFT_ID } from "../../config";
import { Prices } from "./types";
import { bigIntMax, bigIntMin, createAssetConfig, createAssetData } from "./helpers";
import { MyDatabase } from "../../db/database";
import { isAxiosError } from "axios";
import {getPrices} from "./prices";


export async function validateBalances(db: MyDatabase, tonClient: TonClient, iotaClient: Client) {
    try {
        // console.log(`Start validating balances at ${new Date().toLocaleString()}`)
        const users = await db.getUsers();
        const masterAddress = evaaMaster;

        // Prices
        const priceData = await getPrices();
        let pricesDict = priceData.dict;

        // Assets Data
        const assetsDataResult = await tonClient.runMethod(masterAddress, 'getAssetsData');
        const assetsCell = assetsDataResult.stack.readCell();
        const assetsDataDict = assetsCell.beginParse()
            .loadDictDirect(Dictionary.Keys.BigUint(256), createAssetData());

        // Assets config
        const assetConfigResult = await tonClient.runMethod(masterAddress, 'getAssetsConfig');
        const assetConfigDict = assetConfigResult.stack.readCell().beginParse()
            .loadDictDirect(Dictionary.Keys.BigUint(256), createAssetConfig());

        for (const user of users) {
            if (await db.isTaskExists(user.wallet_address)) {
                console.log(`Task for ${user.wallet_address} already exists. Skipping...`);
                continue;
            }
            const principalsDict = Dictionary.empty<bigint, bigint>();
            if (user.tonPrincipal !== 0n)
                principalsDict.set(AssetID.ton, user.tonPrincipal);
            if (user.usdtPrincipal !== 0n)
                principalsDict.set(AssetID.usdt, user.usdtPrincipal);
            if (user.usdcPrincipal !== 0n)
                principalsDict.set(AssetID.usdc, user.usdcPrincipal);

            let gCollateralValue = 0n;
            let gCollateralAsset = 0n;
            let gLoanValue = 0n;
            let gLoanAsset = 0n;
            let totalDebt = 0n;
            let totalLimit = 0n;
            for (const key of principalsDict.keys()) {
                const principal = principalsDict.get(key);
                const assetData = assetsDataDict.get(key);
                const balance = principal > 0 ? principal * assetData.sRate / BigInt(1e12) :
                    principal * assetData.bRate / BigInt(1e12);
                if (balance > 0) {
                    const assetWorth = key === AssetID.ton ?
                        balance * pricesDict.get(key) / 1_000_000_000n :
                        balance * pricesDict.get(key) / 1_000_000n;
                    totalLimit += assetWorth * assetConfigDict.get(key).liquidationThreshold / BigInt(10000);
                    if (assetWorth > gCollateralValue) {
                        gCollateralValue = assetWorth;
                        gCollateralAsset = key;
                    }
                }
                else if (balance < 0) {
                    const assetWorth = key === AssetID.ton ?
                        BigInt(-1) * balance * pricesDict.get(key) / 1_000_000_000n :
                        BigInt(-1) * balance * pricesDict.get(key) / 1_000_000n
                    totalDebt += assetWorth;
                    if (assetWorth > gLoanValue) {
                        gLoanValue = assetWorth;
                        gLoanAsset = key;
                    }
                }
            }

            if (totalLimit < totalDebt) {
                const gLoanAssetPrice: bigint = pricesDict.get(gLoanAsset);
                const values = [];
                const liquidationBonus = assetConfigDict.get(gLoanAsset).liquidationBonus;
                if (gLoanAsset === AssetID.ton) {
                    values.push(bigIntMax(gCollateralValue / 2n, bigIntMin(gCollateralValue, 100_000_000_000n))
                        * decimals.ton * 10000n / liquidationBonus / gLoanAssetPrice);
                    values.push(gLoanValue * decimals.ton / gLoanAssetPrice);
                } else {
                    values.push(bigIntMax(gCollateralValue / 2n, bigIntMin(gCollateralValue, 100_000_000_000n))
                        * decimals.jetton * 10000n / liquidationBonus / gLoanAssetPrice);
                    values.push(BigInt(gLoanValue) * BigInt(decimals.jetton) / BigInt(gLoanAssetPrice));
                }
                const liquidationAmount = bigIntMin(...values) as bigint - 5n;
                const gCollateralAssetPrice: bigint = pricesDict.get(gCollateralAsset);
                const collateralDecimal = gCollateralAsset === AssetID.ton ? decimals.ton : decimals.jetton;
                const loanDecimal = gLoanAsset === AssetID.ton ? decimals.ton : decimals.jetton;
                let minCollateralAmount = liquidationAmount * gLoanAssetPrice * liquidationBonus / 10000n
                    * collateralDecimal / gCollateralAssetPrice / loanDecimal - 10n;
		minCollateralAmount = minCollateralAmount * 97n / 100n;
                if(minCollateralAmount / collateralDecimal >= 1n) {
                    const queryID = BigInt(Date.now());
                    await db.addTask(user.wallet_address, user.contract_address, Date.now(), gLoanAsset, gCollateralAsset,
                        liquidationAmount, minCollateralAmount, priceData.dataCell.toBoc().toString('base64url'), '', queryID);
                    console.log(`Task for ${user.wallet_address} added`);
                } else {
                    // console.log(`Not enough collateral for ${user.wallet_address}`);
                }
            } else {

            }
        }

        // console.log(`Finish validating balances at ${new Date().toLocaleString()}`)
    } catch(e) {
        if(!isAxiosError(e)) {
            console.log(e)
            throw (`Not axios error: ${JSON.stringify(e)}}`);
        }

        if (e.response) {
            console.log(`Error: ${e.response.status} - ${e.response.statusText}`);
        } else if (e.request) {
            console.log(`Error: No response from server.

${e.request}`);
        } else {
            console.log(`Error: unknown`);
        }
        console.log(e)
        console.log(`Error while validating balances...`)
    }
}
