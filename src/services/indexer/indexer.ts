import {DATABASE_DEFAULT_RETRY_OPTIONS, MyDatabase} from "../../db/database";
import {AxiosInstance, AxiosResponse} from "axios";
import {JETTON_WALLETS, RPC_CALL_DELAY, TX_PROCESS_DELAY, USER_UPDATE_DELAY} from "../../config";
import {
    checkEligibleSwapTask,
    DelayedCallDispatcher,
    ERROR_CODE,
    formatLiquidationSuccess,
    formatLiquidationUnsatisfied,
    formatSwapAssignedMessage,
    formatSwapCanceledMessage,
    getErrorDescription,
    makeGetAccountTransactionsRequest,
    OP_CODE,
} from "./helpers";
import {sleep} from "../../util/process";
import {Address, Dictionary} from "@ton/core";
import {Cell, OpenedContract, TonClient} from "@ton/ton";
import {getAddressFriendly, getFriendlyAmount} from "../../util/format";
import {getBalances} from "../../lib/balances";
import {Evaa, EvaaUser, TON_MAINNET} from "@evaafi/sdk";
import {retry} from "../../util/retry";
import {User} from "../../db/types";
import {Messenger} from "../../lib/bot";

export async function getTransactionsBatch(tonApi: AxiosInstance, bot: Messenger, evaaMaster: Address, before_lt: number): Promise<AxiosResponse<any, any>> {
    let attempts = 0;
    while (true) {
        try {
            const request = makeGetAccountTransactionsRequest(evaaMaster, before_lt);
            const res = await tonApi.get(request);
            attempts = 0;
            return res;
        } catch (e) {
            attempts++;
            if (attempts > 3) {
                await bot.sendMessage(`🚨🚨🚨 Unknown problem with TonAPI 🚨🚨🚨`);
                console.log(e);
                await sleep(10000);
                attempts = 0;
            } else {
                await sleep(1000);
            }
        }
    }
}

export async function handleTransactions(db: MyDatabase, tonApi: AxiosInstance, tonClient: TonClient, bot: Messenger, evaa: OpenedContract<Evaa>, walletAddress: Address, sync = false) {
    const getAssetsInfo = (loanAsset: bigint, collateralAsset: bigint) => {
        const loanAssetPoolConfig = evaa.poolConfig.poolAssetsConfig.find(it => it.assetId === loanAsset);
        const collateralAssetPoolConfig = evaa.poolConfig.poolAssetsConfig.find(it => it.assetId === collateralAsset);
        if (!loanAssetPoolConfig) throw (`Asset ${loanAsset} is not supported`);
        if (!collateralAssetPoolConfig) throw (`Asset ${collateralAsset} is not supported`);

        const loanAssetExtConfig = evaa.data.assetsConfig.get(loanAsset);
        const collateralAssetExtConfig = evaa.data.assetsConfig.get(collateralAsset);
        if (!loanAssetExtConfig) throw (`No data for asset ${loanAsset}`);
        if (!collateralAssetExtConfig) throw (`No data for asset ${collateralAsset}`);

        const loanAssetName = loanAssetPoolConfig.name;
        const loanAssetDecimals = loanAssetExtConfig.decimals;
        const collateralAssetName = collateralAssetPoolConfig.name;
        const collateralAssetDecimals = collateralAssetExtConfig.decimals;
        return {
            loanAssetName, loanAssetDecimals, collateralAssetName, collateralAssetDecimals
        }
    }

    const dispatcher = new DelayedCallDispatcher(RPC_CALL_DELAY);

    let before_lt = 0;
    while (true) {
        const batchResult = await getTransactionsBatch(tonApi, bot, evaa.address, before_lt);
        const transactions = batchResult?.data?.transactions;
        if (!Array.isArray(transactions) || (transactions.length === 0)) break;
        const firstTxExists = await db.isTxExists(transactions[0].hash);
        if (firstTxExists) {
            if (sync) break;
            if (before_lt !== 0) {
                console.log(`Resetting before_lt to 0. Before lt was: ${before_lt}`);
                before_lt = 0;
            }
            await sleep(1000);
            continue;
        }
        console.log('Evaa syncing...');
        const syncRes = await retry(
            async () => await evaa.getSync(),
            {attempts: 5, attemptInterval: 1000}
        )
        if (!syncRes.ok) throw (`Failed to sync evaa`);

        console.log('Getting price data...');
        const pricesRes = await retry(
            async () => await evaa.getPrices(),
            {attempts: 15, attemptInterval: 1000}
        );
        if (!pricesRes.ok) throw (`Failed to get price data`);

        const prices: Dictionary<bigint, bigint> = pricesRes?.value?.dict;

        for (const tx of transactions) {
            await sleep(TX_PROCESS_DELAY);
            const hash = tx.hash;
            const utime = tx.utime * 1000;
            const result = await db.isTxExists(hash);
            if (result) continue;
            await db.addTransaction(hash, utime);
            before_lt = tx.lt;

            let _op = tx['in_msg']['op_code'] ? tx['in_msg']['op_code'] : undefined;
            if (_op === undefined) continue;
            const op = parseInt(_op);
            let userContractAddress: Address;

            if (op === OP_CODE.MASTER_SUPPLY
                || op === OP_CODE.MASTER_WITHDRAW
                || op === OP_CODE.MASTER_LIQUIDATE
                || op === OP_CODE.JETTON_TRANSFER_NOTIFICATION
                || op === OP_CODE.DEBUG_PRINCIPALS) {

                if (!(tx.compute_phase.success === true)) continue;

                const outMsgs = tx.out_msgs;
                if (outMsgs.length !== 1) continue;
                userContractAddress = Address.parseRaw(outMsgs[0].destination.address);

                if (op === OP_CODE.JETTON_TRANSFER_NOTIFICATION) {
                    const inAddress = Address.parseRaw(tx.in_msg.source.address);
                    if (inAddress.equals(userContractAddress)) {
                        console.log(`Contract ${getAddressFriendly(userContractAddress)} is not a user contract`);
                        continue;
                    }
                }
            } else if (op === OP_CODE.MASTER_SUPPLY_SUCCESS
                || op === OP_CODE.MASTER_WITHDRAW_COLLATERALIZED
                || op === OP_CODE.MASTER_LIQUIDATE_SATISFIED
                || op == OP_CODE.MASTER_LIQUIDATE_UNSATISFIED) {

                if (!(tx.compute_phase.success === true)) continue;

                userContractAddress = Address.parseRaw(tx.in_msg.source.address);
                if (op === OP_CODE.MASTER_LIQUIDATE_SATISFIED) {
                    tx.out_msgs.sort((a, b) => a.created_lt - b.created_lt);
                    const report = tx.out_msgs[0];
                    if (report === undefined) {
                        throw new Error(`Report is undefined for transaction ${hash}`);
                    }
                    const bodySlice = Cell.fromBoc(Buffer.from(report['raw_body'], 'hex'))[0].beginParse();
                    bodySlice.loadCoins() // contract version
                    bodySlice.loadMaybeRef() // upgrade info
                    bodySlice.loadInt(2) // upgrade exec
                    const reportOp = bodySlice.loadUint(32);
                    if (reportOp != OP_CODE.USER_LIQUIDATE_SUCCESS) {
                        console.log(reportOp.toString(16));
                        console.log(`Report op is not 0x331a for transaction ${hash}`);
                    }
                    const queryID = bodySlice.loadUintBig(64);
                    const task = await db.getTask(queryID);
                    if (task !== undefined) {
                        const assetsInfo = getAssetsInfo(task.loan_asset, task.collateral_asset);
                        const {
                            loanAssetName, collateralAssetName, collateralAssetDecimals
                        } = assetsInfo;

                        const satisfiedTx = Cell.fromBoc(Buffer.from(tx['in_msg']['raw_body'], 'hex'))[0].beginParse();
                        const extra = satisfiedTx.loadRef().beginParse();
                        extra.loadInt(64); // delta loan principal
                        const loanAmount = extra.loadUintBig(64);
                        extra.loadUint(64); // protocol gift
                        extra.loadUintBig(64); // user new loan principal
                        extra.loadUintBig(256); // collateral asset id
                        extra.loadUintBig(64); // delta collateral principal amount
                        const collateralRewardAmount = extra.loadUintBig(64); // collateral reward for liquidation
                        await db.liquidateSuccess(queryID);
                        console.log(`Liquidation task (Query ID: ${queryID}) successfully completed`);

                        const assetIds = evaa.poolConfig.poolAssetsConfig
                            .filter(it => it.assetId !== TON_MAINNET.assetId)
                            .map(it => it.assetId);

                        const myBalance = await getBalances(tonClient, walletAddress, assetIds, JETTON_WALLETS);
                        const localTime = new Date(utime);
                        await bot.sendMessage(
                            formatLiquidationSuccess(task, assetsInfo, loanAmount, collateralRewardAmount,
                                hash, localTime, evaa.address, myBalance, evaa.data.assetsConfig
                            ), {parse_mode: 'HTML'});

                        const isEligibleTask = await checkEligibleSwapTask(
                            task.collateral_asset, collateralRewardAmount, task.loan_asset,
                            evaa.data.assetsConfig, prices, evaa.poolConfig
                        );
                        if (isEligibleTask) {
                            await db.addSwapTask(Date.now(), task.collateral_asset, task.loan_asset, collateralRewardAmount);
                            await bot.sendMessage(
                                formatSwapAssignedMessage(
                                    loanAssetName, collateralAssetName,
                                    collateralRewardAmount, collateralAssetDecimals
                                ), {parse_mode: 'HTML'});
                        } else {
                            await bot.sendMessage(
                                formatSwapCanceledMessage(loanAssetName, collateralAssetName,
                                    collateralRewardAmount, collateralAssetDecimals
                                ), {parse_mode: 'HTML'});
                        }
                    }
                } else if (op === OP_CODE.MASTER_LIQUIDATE_UNSATISFIED) {
                    const unsatisfiedTx = Cell.fromBoc(Buffer.from(tx['in_msg']['raw_body'], 'hex'))[0].beginParse();
                    const op = unsatisfiedTx.loadUint(32);
                    const queryID = unsatisfiedTx.loadUintBig(64);
                    const task = await db.getTask(queryID);
                    if (task !== undefined) {
                        const userAddress = unsatisfiedTx.loadAddress();
                        const liquidatorAddress = unsatisfiedTx.loadAddress();
                        const assetID = unsatisfiedTx.loadUintBig(256);
                        const nextBody = unsatisfiedTx.loadRef().beginParse();
                        unsatisfiedTx.endParse();
                        const transferredAmount = nextBody.loadUintBig(64);
                        const collateralAssetID = nextBody.loadUintBig(256);
                        const minCollateralAmount = nextBody.loadUintBig(64);

                        const {
                            loanAssetName: transferedAssetName,
                            loanAssetDecimals: transferedAssetDecimals,
                            collateralAssetName, collateralAssetDecimals
                        } = getAssetsInfo(assetID, collateralAssetID);

                        console.log('\n----- Unsatisfied liquidation task -----\n')
                        console.log(
                            formatLiquidationUnsatisfied(task,
                                transferedAssetName, transferedAssetDecimals,
                                collateralAssetName, collateralAssetDecimals,
                                transferredAmount, evaa.address, liquidatorAddress
                            ));

                        const errorCode = nextBody.loadUint(32);
                        const errorDescription = getErrorDescription(errorCode);
                        console.log(`Error: ${errorDescription}`);

                        if (errorCode === ERROR_CODE.MASTER_LIQUIDATING_TOO_MUCH) {
                            const maxAllowedLiquidation = nextBody.loadUintBig(64);
                            console.log(`Query ID: ${queryID}`);
                            console.log(`Max allowed liquidation: ${maxAllowedLiquidation}`)
                        } else if (errorCode === ERROR_CODE.USER_WITHDRAW_IN_PROCESS) {
                            await bot.sendMessage(
                                `🚨🚨🚨 Liquidation failed. User <code>${getAddressFriendly(userAddress)}<code/> withdraw in process 🚨🚨🚨`,
                                {parse_mode: 'HTML'});
                        } else if (errorCode === ERROR_CODE.NOT_LIQUIDATABLE) { // error message already logged
                        } else if (errorCode === ERROR_CODE.MIN_COLLATERAL_NOT_SATISFIED) {
                            const collateralAmount = nextBody.loadUintBig(64);
                            console.log(`Collateral amount: ${getFriendlyAmount(collateralAmount, collateralAssetDecimals, collateralAssetName)}`);
                        } else if (errorCode === ERROR_CODE.USER_NOT_ENOUGH_COLLATERAL) {
                            const collateralPresent = nextBody.loadUintBig(64);
                            console.log(`Collateral present: ${getFriendlyAmount(collateralPresent, collateralAssetDecimals, collateralAssetName)}`);
                        } else if (errorCode === ERROR_CODE.USER_LIQUIDATING_TOO_MUCH) {
                            const maxNotTooMuch = nextBody.loadUintBig(64);
                            console.log(`Max not too much: ${maxNotTooMuch}`);
                        } else if (errorCode === ERROR_CODE.MASTER_NOT_ENOUGH_LIQUIDITY) {
                            const availableLiquidity = nextBody.loadUintBig(64);
                            console.log(`Available liquidity: ${availableLiquidity}`);
                        } else if (errorCode === ERROR_CODE.LIQUIDATION_PRICES_MISSING) { // error message already logged
                        }
                        await db.unsatisfyTask(queryID);
                        console.log('\n----- Unsatisfied liquidation task -----\n')
                    }
                }
            } else {
                continue;
            }

            if (!userContractAddress) continue;
            const delay = (Date.now() >= utime + USER_UPDATE_DELAY) ? 0 : USER_UPDATE_DELAY;
            setTimeout(async () => {
                const userContractFriendly = getAddressFriendly(userContractAddress);
                const user = await db.getUser(userContractFriendly);
                if (user && user.updated_at > utime) {
                    await db.updateUserTime(userContractFriendly, utime, utime);
                    // console.log(`Contract ${getAddressFriendly(userContractAddress)} updated (time)`);
                    return;
                }

                const openedUserContract = tonClient.open(EvaaUser.createFromAddress(userContractAddress, evaa.poolConfig));
                const res = await retry(
                    async () => {
                        await dispatcher.makeCall(
                            async () => {
                                console.log('SYNCING USER ', userContractFriendly);
                                return await openedUserContract.getSync(evaa.data.assetsData, evaa.data.assetsConfig, prices);
                            }
                        )
                    }, {attempts: 10, attemptInterval: 2000}
                );

                if (!res.ok) {
                    console.log(`Problem with TonClient. Reindex is needed`);
                    await bot.sendMessage(`🚨🚨🚨 Problem with TonClient. Reindex is needed 🚨🚨🚨`);
                    await bot.sendMessage(`🚨🚨🚨 Problem with user contract ${userContractFriendly} 🚨🚨🚨`);
                    return;
                }

                if (openedUserContract.data.type != 'active') {
                    console.warn(`User ${userContractFriendly} is not active!`);
                    return;
                }

                const {
                    codeVersion,
                    ownerAddress: userAddress,
                    principals
                } = openedUserContract.data;

                const actualUser: User = {
                    id: 0,
                    wallet_address: user?.wallet_address ?? getAddressFriendly(userAddress),
                    contract_address: user?.contract_address ?? userContractFriendly,
                    code_version: codeVersion,
                    created_at: Math.min(utime, user?.created_at ?? Date.now()),
                    updated_at: Math.max(utime, user?.updated_at ?? 0),
                    actualized_at: Date.now(),
                    principals: principals,
                    state: 'active',
                }
                const userRes = await retry(
                    async () => await db.insertOrUpdateUser(actualUser),
                    DATABASE_DEFAULT_RETRY_OPTIONS
                );
                if (!userRes) {
                    const message = `[Indexer]: Failed to actualize user ${userContractFriendly}`;
                    console.warn(message);
                    await bot.sendMessage(message);
                }

            }, delay);
        }

        console.log(`Before lt: ${before_lt}`);
        await sleep(1500);
    }
}
