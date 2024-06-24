import { Dictionary, TonClient} from "@ton/ton";
import { Client } from "@iota/sdk";
import { AssetID, decimals, evaaMaster } from "../../config";
import {bigIntMax, bigIntMin, createAssetConfig, createAssetData, getMiddlewareData} from "./helpers";
import { MyDatabase } from "../../db/database";
import { isAxiosError } from "axios";
import {getPrices} from "./prices";

export async function validateBalances(db: MyDatabase, tonClient: TonClient, iotaClient: Client) {
    try {
        // console.log(`Start validating balances at ${new Date().toLocaleString()}`)
        const users = await db.getUsers();
        const masterAddress = evaaMaster;

        // Prices
        const middlewareData = await getMiddlewareData();
        let pricesDict = middlewareData.pricesCell.beginParse()
            .loadDictDirect(Dictionary.Keys.BigUint(256), Dictionary.Values.BigUint(64));

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
            if (user.jusdtPrincipal !== 0n)
                principalsDict.set(AssetID.jusdt, user.jusdtPrincipal);
            if (user.jusdcPrincipal !== 0n)
                principalsDict.set(AssetID.jusdc, user.jusdcPrincipal);
            if (user.sttonPrincipal !== 0n)
                principalsDict.set(AssetID.stton, user.sttonPrincipal);
            if (user.tstonPrincipal !== 0n)
                principalsDict.set(AssetID.tston, user.tstonPrincipal);
            if (user.usdtPrincipal !== 0n)
                principalsDict.set(AssetID.usdt, user.usdtPrincipal);

            let gCollateralValue = 0n;
            let gCollateralAsset = 0n;
            let gLoanValue = 0n;
            let gLoanAsset = 0n;
            let totalDebt = 0n;
            let totalLimit = 0n;
            for (const key of principalsDict.keys()) {
                const principal = principalsDict.get(key);
                const assetData = assetsDataDict.get(key);
                const assetConfig = assetConfigDict.get(key);
                const balance = principal > 0 ? principal * assetData.sRate / BigInt(1e12) :
                    principal * assetData.bRate / BigInt(1e12);
                if (balance > 0) {
                    const assetWorth =  balance * pricesDict.get(key) / 10n ** assetConfig.decimals
                    totalLimit += assetWorth * assetConfigDict.get(key).liquidationThreshold / BigInt(10000);
                    if (assetWorth > gCollateralValue) {
                        gCollateralValue = assetWorth;
                        gCollateralAsset = key;
                    }
                }
                else if (balance < 0) {
                    const assetWorth = BigInt(-1) * balance * pricesDict.get(key) / 10n ** assetConfig.decimals;
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
                const collateralAssetConfig = assetConfigDict.get(gCollateralAsset);
                const loanAssetConfig = assetConfigDict.get(gLoanAsset);
                const liquidationBonus = collateralAssetConfig.liquidationBonus;
                const collateralDecimal = 10n ** collateralAssetConfig.decimals;
                const loanDecimal = 10n ** loanAssetConfig.decimals;
                values.push(bigIntMax(gCollateralValue / 2n, bigIntMin(gCollateralValue, 100_000_000_000n))
                    * loanDecimal * 10000n / liquidationBonus / gLoanAssetPrice);
                values.push(gCollateralValue / 2n * loanDecimal * 10000n / liquidationBonus / gLoanAssetPrice);
                values.push(gLoanValue * loanDecimal / gLoanAssetPrice);
                const liquidationAmount = bigIntMin(...values) as bigint - 5n;
                const gCollateralAssetPrice: bigint = pricesDict.get(gCollateralAsset);
                let minCollateralAmount = liquidationAmount * gLoanAssetPrice * liquidationBonus / 10000n
                    * collateralDecimal / gCollateralAssetPrice / loanDecimal - 10n;
		minCollateralAmount = minCollateralAmount * 97n / 100n;
                if(minCollateralAmount / collateralDecimal >= 1n) {
                    const queryID = BigInt(Date.now());
                    await db.addTask(user.wallet_address, user.contract_address, Date.now(), gLoanAsset, gCollateralAsset,
                        liquidationAmount, minCollateralAmount, middlewareData.pricesCell.toBoc().toString('base64'), middlewareData.signature.toString('hex'), queryID);
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
