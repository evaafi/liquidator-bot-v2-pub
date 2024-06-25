import {MyDatabase} from "../../db/database";
import {AxiosInstance, AxiosResponse, isAxiosError} from "axios";
import {AssetID, decimals, evaaMaster, serviceChatID} from "../../config";
import {getAddressFriendly, getAssetName, getFriendlyAmount, getRequest} from "./helpers";
import {sleep} from "../../helpers";
import {Address} from "@ton/core";
import {GetResult, UserPrincipals} from "./types";
import {Cell, Dictionary, TonClient} from "@ton/ton";
import {Bot} from "grammy";
import {getMyBalance} from "../liquidator";
import * as fs from "fs";

let lastRpcCall = 0;

const errorCodes = {
    0x30F1: "Master liquidating too much",
    0x31F2: "Not liquidatable",
    0x31F3: "Min collateral not satisfied",
    0x31F4: "User not enough collateral",
    0x31F5: "User liquidating too much",
    0x31F6: "Master not enough liquidity",
    0x31F0: "User withdraw in process"
}

export async function handleTransactions(db: MyDatabase, tonApi: AxiosInstance, tonClient: TonClient, bot: Bot, walletAddress: Address, sync = false) {
    let before_lt = 0;
    let attempts = 0;
    while (true) {
        let result: AxiosResponse<any, any>;
        try {
            result = await tonApi.get(getRequest(evaaMaster, before_lt));
            attempts = 0;
        } catch (e) {
            attempts++;
            if (attempts > 3) {
                await bot.api.sendMessage(serviceChatID, `🚨🚨🚨 Unknown problem with TonAPI 🚨🚨🚨`);
                console.log(e);
                await sleep(10000);
                attempts = 0;
            }
            await sleep(1000);
            continue;
        }
        const transactions = result.data.transactions;
        if (transactions.length === 0) break;
        const first = await db.isTxExists(transactions[0].hash);
        if (first) {
            if (sync) break;
            if (before_lt !== 0) {
                console.log(`Resetting before_lt to 0. Before lt was: ${before_lt}`);
                before_lt = 0;
            }
            await sleep(1000);
            continue;
        }

        for (const transaction of transactions) {
            const hash = transaction.hash;
            const utime = transaction.utime * 1000;
            const result = await db.isTxExists(hash);
            if (result) continue;
            await db.addTransaction(hash, utime);
            // console.log(`Transaction ${hash} added`);
            before_lt = transaction.lt;

            let op = transaction['in_msg']['op_code'] ? transaction['in_msg']['op_code'] : undefined;
            if (op === undefined) continue;
            op = parseInt(op);
            let userContractAddress: Address;
            if (op === 0x1 || op === 0x2 || op === 0x3 || op === 0x7362d09c || op === 0xd2) {
                if (!(transaction.compute_phase.success === true)) continue;
                const outMsgs = transaction.out_msgs;
                if (outMsgs.length !== 1) continue;
                userContractAddress = Address.parseRaw(outMsgs[0].destination.address);
                if (op === 0x7362d09c) {
                    const inAddress = Address.parseRaw(transaction.in_msg.source.address);
                    if (inAddress.equals(userContractAddress)) {
                        console.log(`Contract ${getAddressFriendly(userContractAddress)} is not a user contract`);
                        continue;
                    }
                }
            }
            else if (op === 0x11a || op === 0x211 || op === 0x311 || op == 0x31f) {
                if (!(transaction.compute_phase.success === true)) continue;
                userContractAddress = Address.parseRaw(transaction.in_msg.source.address);
                if(op === 0x311) {
                    transaction.out_msgs.sort((a, b) => a.created_lt - b.created_lt);
                    const report = transaction.out_msgs[0];
                    if(report === undefined) {
                        throw new Error(`Report is undefined for transaction ${hash}`);
                    }
                    const bodySlice = Cell.fromBoc(Buffer.from(report['raw_body'], 'hex'))[0].beginParse();
                    bodySlice.loadCoins() // contract version
                    bodySlice.loadMaybeRef() // upgrade info
                    bodySlice.loadInt(2) // upgrade exec
                    const reportOp = bodySlice.loadUint(32);
                    if(reportOp != 0x311a) {
                        console.log(reportOp.toString(16));
                        console.log(`Report op is not 0x331a for transaction ${hash}`);
                    }
                    const queryID = bodySlice.loadUintBig(64);
                    const task = await db.getTask(queryID);
                    if(task !== undefined) {
                        const satisfiedTx = Cell.fromBoc(Buffer.from(transaction['in_msg']['raw_body'], 'hex'))[0].beginParse();
                        const extra = satisfiedTx.loadRef().beginParse();
                        extra.loadInt(64); // delta loan principal
                        const loanAmount = extra.loadUintBig(64);
                        extra.loadUint(64); // protocol gift
                        extra.loadUintBig(256); // collateral asset id
                        extra.loadUintBig(64); // delta collateral principal
                        extra.loadUintBig(64); // something related to collateral, but it's not the actual returned during a liquidation
                        const collateralAmount = extra.loadUintBig(64);
                        await db.liquidateSuccess(queryID);
                        console.log(`Liquidation task (Query ID: ${queryID}) successfully completed`);
                        const myBalance = await getMyBalance(tonClient, walletAddress);
                        const localTime = new Date(utime);
                        const utcTime = new Date(localTime.getTime() + localTime.getTimezoneOffset() * 60000);
                        await bot.api.sendMessage(serviceChatID, `✅ Liquidation task (Query ID: ${queryID}) successfully completed

<b>Loan asset:</b> ${getAssetName(task.loanAsset)}
<b>Loan amount:</b> ${getFriendlyAmount(loanAmount, getAssetName(task.loanAsset))}
<b>Collateral asset:</b> ${getAssetName(task.collateralAsset)}
<b>Collateral amount:</b> ${getFriendlyAmount(collateralAmount, getAssetName(task.collateralAsset))}

<b>User address:</b> <code>${getAddressFriendly(task.walletAddress)}</code>
<b>Contract address:</b> <code>${getAddressFriendly(task.contractAddress)}</code>
<b>Hash</b>: <code>${hash}</code>
<b>Time:</b> ${utcTime.toLocaleString()} UTC

<b>My balance:</b>
<b>- TON:</b> ${getFriendlyAmount(myBalance.ton, "TON")}
<b>- jUSDT:</b> ${getFriendlyAmount(myBalance.jusdt, "jUSDT")}
<b>- jUSDC:</b> ${getFriendlyAmount(myBalance.jusdc, "jUSDC")}
<b>- stTON:</b> ${getFriendlyAmount(myBalance.stton, "stTON")}
<b>- TSTON:</b> ${getFriendlyAmount(myBalance.tston, "tsTON")}
<b>- USDT:</b> ${getFriendlyAmount(myBalance.usdt, "USDT")}`, { parse_mode: 'HTML' });
                    }
                }
                else if (op === 0x31f) {
                    const unsatisfiedTx = Cell.fromBoc(Buffer.from(transaction['in_msg']['raw_body'], 'hex'))[0].beginParse();
                    const op = unsatisfiedTx.loadUint(32);
                    const queryID = unsatisfiedTx.loadUintBig(64);
                    const task = await db.getTask(queryID);
                    if(task !== undefined) {
                        const userAddress = unsatisfiedTx.loadAddress();
                        const liquidatorAddress = unsatisfiedTx.loadAddress();
                        const assetID = unsatisfiedTx.loadUintBig(256);
                        const nextBody = unsatisfiedTx.loadRef().beginParse();
                        unsatisfiedTx.endParse();
                        const transferredAmount = nextBody.loadUintBig(64);
                        const collateralAssetID = nextBody.loadUintBig(256);
                        const minCollateralAmount = nextBody.loadUintBig(64);
                        console.log('\n----- Unsatisfied liquidation task -----\n')
                        console.log(`userAddress: ${getAddressFriendly(userAddress)}
liquidatorAddress: ${getAddressFriendly(liquidatorAddress)}
assetID: ${getAssetName(assetID)}
transferredAmount: ${getFriendlyAmount(transferredAmount, getAssetName(assetID))}
collateralAssetID: ${getAssetName(collateralAssetID)}
minCollateralAmount: ${getFriendlyAmount(minCollateralAmount, getAssetName(collateralAssetID))}\n`);

                        const errorCode = nextBody.loadUint(32);
                        if (errorCode === 0x30F1) {
                            const maxAllowedLiquidation = nextBody.loadUintBig(64);
                            console.log(`Error: ${errorCodes[errorCode]}
Query ID: ${queryID}
Max allowed liquidation: ${maxAllowedLiquidation}`)
                        }
                        else if (errorCode === 0x31F0) {
                            console.log(`Error: ${errorCodes[errorCode]}`);
                            await bot.api.sendMessage(serviceChatID, `🚨🚨🚨 Liquidation failed. User <code>${getAddressFriendly(userAddress)}<code/> withdraw in process 🚨🚨🚨`,
                                { parse_mode: 'HTML' });
                        }
                        else if (errorCode === 0x31F2) {
                            console.log(`Error: ${errorCodes[errorCode]}`);
                        }
                        else if (errorCode === 0x31F3) {
                            const collateralAmount = nextBody.loadUintBig(64);
                            console.log(`Error: ${errorCodes[errorCode]}
Collateral amount: ${getFriendlyAmount(collateralAmount, getAssetName(collateralAssetID))}`);
                        }
                        else if (errorCode === 0x31F4) {
                            const collateralPresent = nextBody.loadUintBig(64);
                            console.log(`Error: ${errorCodes[errorCode]}
Collateral present: ${getFriendlyAmount(collateralPresent, getAssetName(collateralAssetID))}`);
                        }
                        else if (errorCode === 0x31F5) {
                            const maxNotTooMuch = nextBody.loadUintBig(64);
                            console.log(`Error: ${errorCodes[errorCode]}
Max not too much: ${maxNotTooMuch}`);
                        }
                        else if (errorCode === 0x31F6) {
                            const availableLiquidity = nextBody.loadUintBig(64);
                            console.log(`Error: ${errorCodes[errorCode]}
Available liquidity: ${availableLiquidity}`);
                        }
                        await db.unsatisfyTask(queryID);
                        console.log('\n----- Unsatisfied liquidation task -----\n')
                    }
                }
            }
            else {
                continue;
            }
            let userDataResult: GetResult;
            setTimeout(async () => {
                const user = await db.getUser(getAddressFriendly(userContractAddress));

                if(user && user.updatedAt > utime) {
                    await db.updateUserTime(getAddressFriendly(userContractAddress), utime, utime);
                    // console.log(`Contract ${getAddressFriendly(userContractAddress)} updated (time)`);
                    return;
                }

                let attempts = 0;
                let userDataSuccess = false;
                while (true) {
                    try {
                        // if (Date.now() - lastRpcCall < 200) {
                        //     await sleep(200);
                        //     continue;
                        // }
                        // lastRpcCall = Date.now();
                        userDataResult = await tonClient.runMethodWithError(
                            userContractAddress, 'getAllUserScData'
                        );

                        if (userDataResult.exit_code === 0) {
                            userDataSuccess = true;
                            break;
                        }

                        attempts++;
                        if (attempts > 10) {
                            console.log(`Problem with user contract ${getAddressFriendly(userContractAddress)}`);
                            break;
                        }
                        await sleep(2000);
                    } catch (e) {
                        attempts++;
                        if (attempts > 10) {
                            console.log(e);
                            console.log(`Problem with TonClient. Reindex is needed`);
                            await bot.api.sendMessage(serviceChatID, `🚨🚨🚨 Problem with TonClient. Reindex is needed 🚨🚨🚨`);
                            break;
                        }
                        if (!isAxiosError(e)) {
                            console.log(isAxiosError(e));
                            console.log(e)
                        }
                        await sleep(2000);
                    }
                }
                if (!userDataSuccess) {
                    await bot.api.sendMessage(serviceChatID, `🚨🚨🚨 Problem with user contract ${getAddressFriendly(userContractAddress)} 🚨🚨🚨`);
                    return;
                }
                if (userDataResult.exit_code !== 0) {
                    await bot.api.sendMessage(serviceChatID, `🚨🚨🚨 Problem with user contract ${getAddressFriendly(userContractAddress)} 🚨🚨🚨`);
                    console.log(userDataResult)
                    return;
                }
                const codeVersion = userDataResult.stack.readNumber();
                userDataResult.stack.readCell(); // master
                const userAddress = userDataResult.stack.readCell().beginParse().loadAddress();
                const principalsDict = userDataResult.stack.readCellOpt()?.beginParse()
                    .loadDictDirect(Dictionary.Keys.BigUint(256), Dictionary.Values.BigInt(64));

                const userPrincipals: UserPrincipals = {
                    ton: 0n,
                    jusdt: 0n,
                    jusdc: 0n,
                    stton: 0n,
                    tston: 0n,
                    usdt: 0n,
                };
                if (principalsDict !== undefined) {
                    if (principalsDict.has(AssetID.ton))
                        userPrincipals.ton = principalsDict.get(AssetID.ton);
                    if (principalsDict.has(AssetID.jusdt))
                        userPrincipals.jusdt = principalsDict.get(AssetID.jusdt);
                    if (principalsDict.has(AssetID.jusdc))
                        userPrincipals.jusdc = principalsDict.get(AssetID.jusdc);
                    if (principalsDict.has(AssetID.stton))
                        userPrincipals.stton = principalsDict.get(AssetID.stton);
                    if (principalsDict.has(AssetID.tston))
                        userPrincipals.tston = principalsDict.get(AssetID.tston);
                    if (principalsDict.has(AssetID.usdt))
                        userPrincipals.usdt = principalsDict.get(AssetID.usdt);
                }

                if (user) {
                    if (user.createdAt > utime)
                        user.createdAt = utime;
                    if (user.updatedAt < utime)
                        user.updatedAt = utime;
                    if (user.codeVersion != codeVersion)
                        user.codeVersion = codeVersion;
                    await db.updateUser(getAddressFriendly(userContractAddress), user.codeVersion,
                        user.createdAt, user.updatedAt, userPrincipals.ton,
                        userPrincipals.jusdt, userPrincipals.jusdc, userPrincipals.stton, userPrincipals.tston, userPrincipals.usdt);
                    // console.log(`Contract ${getAddressFriendly(userContractAddress)} updated`);
                }
                else {
                    try {
                        await db.addUser(getAddressFriendly(userAddress), getAddressFriendly(userContractAddress), codeVersion,
                            utime, utime, userPrincipals.ton, userPrincipals.jusdt, userPrincipals.jusdc, userPrincipals.stton, userPrincipals.tston, userPrincipals.usdt);
                        console.log(`Contract ${getAddressFriendly(userContractAddress)} added`);
                    } catch (e) {
                        await db.updateUser(getAddressFriendly(userContractAddress), codeVersion,
                            utime, utime, userPrincipals.ton, userPrincipals.jusdt, userPrincipals.jusdc, userPrincipals.stton, userPrincipals.tston, userPrincipals.usdt);
                        // console.log(`Contract ${getAddressFriendly(userContractAddress)} updated`);
                    }
                }
            }, 60000);
        }

        console.log(`Before lt: ${before_lt}`);
        await sleep(1500);
    }
}
