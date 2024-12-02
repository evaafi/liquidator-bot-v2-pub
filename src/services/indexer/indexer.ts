import {DATABASE_DEFAULT_RETRY_OPTIONS, MyDatabase} from "../../db/database";
import {AxiosInstance, AxiosResponse} from "axios";
import {JETTON_WALLETS, RPC_CALL_DELAY, TX_PROCESS_DELAY, USER_UPDATE_DELAY} from "../../config";
import {
    checkEligibleSwapTask,
    DelayedCallDispatcher,
    formatLiquidationSuccess,
    formatLiquidationUnsatisfied,
    formatSwapAssignedMessage,
    formatSwapCanceledMessage,
    getAssetInfo,
    getErrorDescription,
    makeGetAccountTransactionsRequest,
    OP_CODE,
    parseSatisfiedTxMsg,
    parseUnsatisfiedTxMsg,
} from "./helpers";
import {sleep} from "../../util/process";
import {Address} from "@ton/core";
import {Cell, Dictionary, OpenedContract, TonClient} from "@ton/ton";
import {getAddressFriendly, getFriendlyAmount} from "../../util/format";
import {getBalances} from "../../lib/balances";
import {ASSET_ID, Evaa, EvaaUser} from "@evaafi/sdk";
import {retry} from "../../util/retry";
import {User} from "../../db/types";
import {logMessage, Messenger} from "../../lib/messenger";
import {unpackPrices} from "../../util/prices";

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

export async function handleTransactions(db: MyDatabase, tonApi: AxiosInstance, tonClient: TonClient, messenger: Messenger, evaa: OpenedContract<Evaa>, walletAddress: Address, sync = false) {
    const dispatcher = new DelayedCallDispatcher(RPC_CALL_DELAY);

    let before_lt = 0;
    while (true) {
        const batchResult = await getTransactionsBatch(tonApi, messenger, evaa.address, before_lt);
        const transactions = batchResult?.data?.transactions;
        if (!Array.isArray(transactions) || (transactions.length === 0)) break;
        const firstTxExists = await db.isTxExists(transactions[0].hash);
        if (firstTxExists) {
            if (sync) break;
            if (before_lt !== 0) {
                logMessage(`Indexer: Resetting before_lt to 0. Before lt was: ${before_lt}`);
                before_lt = 0;
            }
            await sleep(1000);
            continue;
        }

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
                        logMessage(`Indexer: Contract ${getAddressFriendly(userContractAddress)} is not a user contract`);
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
                    if (!report) {
                        throw new Error(`Report is undefined for transaction ${hash}`);
                    }
                    const bodySlice = Cell.fromBoc(Buffer.from(report['raw_body'], 'hex'))[0].beginParse();
                    bodySlice.loadCoins() // contract version
                    bodySlice.loadMaybeRef() // upgrade info
                    bodySlice.loadInt(2) // upgrade exec
                    const reportOp = bodySlice.loadUint(32);
                    if (reportOp != OP_CODE.USER_LIQUIDATE_SUCCESS) {
                        logMessage(`Indexer: ${reportOp.toString(16)}`);
                        logMessage(`Indexer: Report op is not 0x331a for transaction ${hash}`);
                    }
                    const queryID = bodySlice.loadUintBig(64);
                    const task = await db.getTask(queryID);
                    if (task !== undefined) {
                        await db.liquidateSuccess(queryID);
                        logMessage(`Indexer: Liquidation task (Query ID: ${queryID}) successfully completed`);

                        const loanAsset = getAssetInfo(task.loan_asset, evaa);
                        const collateralAsset = getAssetInfo(task.collateral_asset, evaa);

                        const satisfiedTx = Cell.fromBoc(Buffer.from(tx['in_msg']['raw_body'], 'hex'))[0].beginParse();
                        const parsedTx = parseSatisfiedTxMsg(satisfiedTx);
                        const prices: Dictionary<bigint, bigint> = unpackPrices(Cell.fromBase64(task.prices_cell))

                        const assetIds = evaa.poolConfig.poolAssetsConfig
                            .filter(it => it.assetId !== ASSET_ID.TON)
                            .map(it => it.assetId);

                        const liquidatorBalances = await getBalances(tonClient, walletAddress, assetIds, JETTON_WALLETS);
                        const localTime = new Date(utime);
                        await messenger.sendMessage(
                            formatLiquidationSuccess(
                                task, loanAsset, collateralAsset, parsedTx,
                                hash, localTime, evaa.address, liquidatorBalances,
                                evaa.data.assetsConfig, evaa.poolConfig.poolAssetsConfig, prices
                            ));

                        const skipCheck = false;
                        let shouldSwap = skipCheck;
                        if (!skipCheck) {
                            shouldSwap = await checkEligibleSwapTask(
                                task.collateral_asset, parsedTx.collateralRewardAmount, task.loan_asset,
                                evaa.data.assetsConfig, prices, evaa.poolConfig
                            );
                        }

                        if (shouldSwap) {
                            // swapper will check it
                            await db.addSwapTask(Date.now(), task.collateral_asset, task.loan_asset, parsedTx.collateralRewardAmount, task.prices_cell);
                            await messenger.sendMessage(formatSwapAssignedMessage(loanAsset, collateralAsset, parsedTx.collateralRewardAmount));
                        } else {
                            await messenger.sendMessage(formatSwapCanceledMessage(loanAsset, collateralAsset, parsedTx.collateralRewardAmount));
                        }
                    }
                } else if (op === OP_CODE.MASTER_LIQUIDATE_UNSATISFIED) {
                    const unsatisfiedTx = Cell.fromBoc(Buffer.from(tx['in_msg']['raw_body'], 'hex'))[0].beginParse();
                    const parsedTx = parseUnsatisfiedTxMsg(unsatisfiedTx);
                    const task = await db.getTask(parsedTx.queryID);
                    if (task !== undefined) {
                        await db.unsatisfyTask(parsedTx.queryID);

                        const transferredInfo = getAssetInfo(parsedTx.transferredAssetID, evaa);
                        const collateralInfo = getAssetInfo(parsedTx.collateralAssetID, evaa);

                        console.log('\n----- Unsatisfied liquidation task -----\n');
                        const unsatisfiedDescription = formatLiquidationUnsatisfied(task,
                            transferredInfo, collateralInfo, parsedTx.transferredAmount,
                            evaa.address, parsedTx.liquidatorAddress
                        );
                        logMessage(unsatisfiedDescription);

                        const errorDescription = getErrorDescription(parsedTx.error.errorCode);

                        logMessage(`Indexer: Error: ${errorDescription}`);
                        const errorType = parsedTx.error.type;
                        if (errorType === 'MasterLiquidatingTooMuchError') {
                            logMessage(`Query ID: ${parsedTx.queryID}`);
                            logMessage(`Max allowed liquidation: ${parsedTx.error.maxAllowedLiquidation}`)
                        } else if (errorType === 'UserWithdrawInProgressError') {
                            await messenger.sendMessage(`🚨🚨🚨 Liquidation failed. User <code>${getAddressFriendly(parsedTx.userAddress)}<code/> withdraw in process 🚨🚨🚨`);
                        } else if (errorType === 'NotLiquidatableError') { // error message already logged
                        } else if (errorType === 'MinCollateralNotSatisfiedError') {
                            logMessage(`Collateral amount: ${getFriendlyAmount(parsedTx.error.minCollateralAmount, collateralInfo.decimals, collateralInfo.name)}`);
                        } else if (errorType === 'UserNotEnoughCollateralError') {
                            logMessage(`Collateral present: ${getFriendlyAmount(parsedTx.error.collateralPresent, collateralInfo.decimals, collateralInfo.name)}`);
                        } else if (errorType === 'UserLiquidatingTooMuchError') {
                            logMessage(`Max not too much: ${parsedTx.error.maxNotTooMuchValue}`);
                        } else if (errorType === 'MasterNotEnoughLiquidityError') {
                            logMessage(`Available liquidity: ${parsedTx.error.availableLiquidity}`);
                        } else if (errorType === 'LiquidationPricesMissing') { // error message already logged
                        }

                        console.log('\n----- Unsatisfied liquidation task -----\n');
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
                    console.log(`Indexer: Update user time for contract ${userContractFriendly}`);
                    await db.updateUserTime(userContractFriendly, utime, utime);
                    // console.log(`Contract ${getAddressFriendly(userContractAddress)} updated (time)`);
                    return;
                }

                const openedUserContract = tonClient.open(EvaaUser.createFromAddress(userContractAddress, evaa.poolConfig));
                const res = await retry(
                    async () => {
                        await dispatcher.makeCall(
                            async () => {
                                logMessage(`Indexer: syncing user ${userContractFriendly}`);
                                return await openedUserContract.getSyncLite(evaa.data.assetsData, evaa.data.assetsConfig);
                            }
                        )
                    }, {attempts: 10, attemptInterval: 2000}
                );

                if (!res.ok) {
                    logMessage(`Indexer: Problem with TonClient. Reindex is needed. User contract: ${userContractFriendly}`);
                    await messenger.sendMessage([
                        `🚨🚨🚨 Problem with TonClient. Reindex is needed 🚨🚨🚨`,
                        `🚨🚨🚨 Problem with user contract ${userContractFriendly} 🚨🚨🚨`
                    ].join('\n'));
                    return;
                }

                if (openedUserContract.liteData.type != 'active') {
                    logMessage(`Indexer: User ${userContractFriendly} is not active!`);
                    return;
                }

                const {
                    codeVersion,
                    ownerAddress: userAddress,
                    principals
                } = openedUserContract.liteData;

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
                    const message = `Indexer: Failed to actualize user ${userContractFriendly}`;
                    logMessage(message);
                    await messenger.sendMessage(message);
                }

            }, delay);
        }

        logMessage(`Indexer: Before lt: ${before_lt}`);
        await sleep(1500);
    }
}
