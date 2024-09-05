import {Dictionary, TonClient} from "@ton/ton";
import {AssetID, CollateralSelectPriorities, evaaMaster, MIN_WORTH_SWAP_LIMIT, serviceChatID} from "../../config";
import {bigIntMax, bigIntMin, createAssetConfig, createAssetData} from "./helpers";
import {MyDatabase} from "../../db/database";
import {isAxiosError} from "axios";
import {User} from "../../db/types";
import {getPrices} from '../../util/prices';

function makePrincipalsDict(user: User): Dictionary<bigint, bigint> {
    const principalsDict = Dictionary.empty<bigint, bigint>();
    if (user.tonPrincipal !== 0n)
        principalsDict.set(AssetID.TON, user.tonPrincipal);
    if (user.jusdtPrincipal !== 0n)
        principalsDict.set(AssetID.jUSDT, user.jusdtPrincipal);
    if (user.jusdcPrincipal !== 0n)
        principalsDict.set(AssetID.jUSDC, user.jusdcPrincipal);
    if (user.sttonPrincipal !== 0n)
        principalsDict.set(AssetID.stTON, user.sttonPrincipal);
    if (user.tstonPrincipal !== 0n)
        principalsDict.set(AssetID.tsTON, user.tstonPrincipal);
    if (user.usdtPrincipal !== 0n)
        principalsDict.set(AssetID.USDT, user.usdtPrincipal);

    // // for lp version
    // if (user.dedustTonUsdtPrincipal !== 0n)
    //     principalsDict.set(AssetID.TONUSDT_DEDUST, user.dedustTonUsdtPrincipal);
    // if (user.stonfiTonUsdtPrincipal !== 0n)
    //     principalsDict.set(AssetID.TONUSDT_STONFI, user.stonfiTonUsdtPrincipal);
    // if (user.stormTonPrincipal !== 0n)
    //     principalsDict.set(AssetID.TON_STORM, user.stormTonPrincipal);
    // if (user.stormUsdtPrincipal !== 0n)
    //     principalsDict.set(AssetID.USDT_STORM, user.stormUsdtPrincipal);

    return principalsDict;
}

export function selectCollateral<
    Config extends { decimals: bigint, liquidationThreshold: bigint },
    Data extends { sRate: bigint, bRate: bigint }
>(
    principalsDict: Dictionary<bigint, bigint>,
    pricesDict: Dictionary<bigint, bigint>,
    assetConfigDict: Dictionary<bigint, Config>,
    assetsDataDict: Dictionary<bigint, Data>
) {
    let gCollateralValue = 0n;
    let gCollateralAsset = 0n;
    let gLoanValue = 0n;
    let gLoanAsset = 0n;
    let totalDebt = 0n;
    let totalLimit = 0n;

    const NO_PRIORITY_SELECTED = 999;
    let selected_collateral_id = 0n;
    let selected_collateral_value = 0n;
    let selected_priority = NO_PRIORITY_SELECTED;

    for (const assetId of principalsDict.keys()) {
        const principal = principalsDict.get(assetId);
        const assetData = assetsDataDict.get(assetId);
        const assetConfig = assetConfigDict.get(assetId);
        const balance = principal > 0 ?
            (principal * assetData.sRate / BigInt(1e12)) :
            (principal * assetData.bRate / BigInt(1e12));

        if (balance > 0) {
            const assetWorth = balance * pricesDict.get(assetId) / 10n ** assetConfig.decimals
            totalLimit += assetWorth * assetConfigDict.get(assetId).liquidationThreshold / 10_000n;

            // priority based collateral selection logic
            if (assetWorth > MIN_WORTH_SWAP_LIMIT) {
                const priority = CollateralSelectPriorities.get(assetId);
                if ((priority !== undefined) && (selected_priority > priority)) {
                    selected_priority = priority;
                    selected_collateral_id = assetId;
                    selected_collateral_value = assetWorth;
                }
            }

            if (assetWorth > gCollateralValue) {
                gCollateralValue = assetWorth;
                gCollateralAsset = assetId;
            }
        } else if (balance < 0) {
            const assetWorth = BigInt(-1) * balance * pricesDict.get(assetId) / 10n ** assetConfig.decimals;
            totalDebt += assetWorth;
            if (assetWorth > gLoanValue) {
                gLoanValue = assetWorth;
                gLoanAsset = assetId;
            }
        }
    }

    // use old collateral selection logic
    if (selected_priority < NO_PRIORITY_SELECTED) {
        gCollateralAsset = selected_collateral_id;
        gCollateralValue = selected_collateral_value;
    }

    return {
        gCollateralValue, gCollateralAsset,
        gLoanValue, gLoanAsset,
        totalDebt, totalLimit,
    }
}

export async function validateBalances(db: MyDatabase, tonClient: TonClient, bot: any) {
    try {
        // console.log(`Start validating balances at ${new Date().toLocaleString()}`)
        const users = await db.getUsers();
        const masterAddress = evaaMaster;

        // Prices
        const {dict: pricesDict, dataCell} = await getPrices();
        const dataSlice = dataCell.beginParse();
        const pricesCell = dataSlice.loadRef();
        if (dataSlice.remainingBits !== 512) {
            throw (`Invalid num of bits for signature: ${dataSlice.remainingBits}, but expected 512`);
        }
        const signature = dataSlice.loadBuffer(64);

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
            const principalsDict = makePrincipalsDict(user);
            const {
                gCollateralValue, gCollateralAsset,
                gLoanValue, gLoanAsset,
                totalDebt, totalLimit,
            } = selectCollateral(principalsDict, pricesDict, assetConfigDict, assetsDataDict);

            if (totalLimit < totalDebt) {
                const gLoanAssetPrice: bigint = pricesDict.get(gLoanAsset);
                const values = [];
                const collateralAssetConfig = assetConfigDict.get(gCollateralAsset);
                if (gCollateralAsset === 0n) {
                    const message = `[Validator]: Problem with user ${user.wallet_address}: collateral not selected, user was blacklisted`;
                    console.warn(message);
                    await db.blacklistUser(user.wallet_address);
                    bot.api.sendMessage(serviceChatID, message);
                    continue;
                }
                const loanAssetConfig = assetConfigDict.get(gLoanAsset);
                const liquidationBonus = collateralAssetConfig.liquidationBonus;
                const collateralDecimal = 10n ** collateralAssetConfig.decimals;
                const loanDecimal = 10n ** loanAssetConfig.decimals;
                values.push(bigIntMax(gCollateralValue / 4n, bigIntMin(gCollateralValue, 100_000_000_000n))
                    * loanDecimal * 10000n / liquidationBonus / gLoanAssetPrice);
                values.push(gLoanValue * loanDecimal / gLoanAssetPrice);
                const liquidationAmount = bigIntMin(...values) as bigint - 5n;
                const gCollateralAssetPrice: bigint = pricesDict.get(gCollateralAsset);
                let minCollateralAmount = liquidationAmount * gLoanAssetPrice * liquidationBonus / 10000n
                    * collateralDecimal / gCollateralAssetPrice / loanDecimal - 10n;
                minCollateralAmount = minCollateralAmount * 99n / 100n;
                if (minCollateralAmount >= pricesDict.get(AssetID.TON) * collateralDecimal / gCollateralAssetPrice) {
                    const queryID = BigInt(Date.now());
                    await db.addTask(user.wallet_address, user.contract_address, Date.now(), gLoanAsset, gCollateralAsset,
                        liquidationAmount, minCollateralAmount,
                        pricesCell.toBoc().toString('base64'),
                        signature.toString('hex'),
                        queryID);
                    console.log(`Task for ${user.wallet_address} added`);
                } else {
                    // console.log(`Not enough collateral for ${user.wallet_address}`);
                }
            } else {

            }
        }

        // console.log(`Finish validating balances at ${new Date().toLocaleString()}`)
    } catch (e) {
        if (!isAxiosError(e)) {
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
