import {KeyPair, sign} from "@ton/crypto";
import {Address, ContractProvider, external, internal, storeMessage, storeMessageRelaxed} from "@ton/core";
import {beginCell, Cell, Dictionary, toNano, TonClient, WalletContractV4} from "@ton/ton";
import { MyDatabase } from "../db/database";
import {AssetID, evaaMaster, highloadAddress, jettonWallets, serviceChatID} from "../config";
import {getAddressFriendly, getAssetName, getFriendlyAmount} from "./indexer/helpers";
import {getJettonWallet, sleep} from "../helpers";
import { Bot } from "grammy";
import crypto from "crypto";
import * as fs from "fs";

type MyBalance = {
    ton: bigint,
    usdt: bigint,
    usdc: bigint,
    stton: bigint,
    tston: bigint,
}

export async function getMyBalance(tonClient: TonClient, walletAddress: Address): Promise<MyBalance> {
    const myBalance: MyBalance = {
        ton: 0n,
        usdt: 0n,
        usdc: 0n,
        stton: 0n,
        tston: 0n,
    };

    let attempts = 0;
    while (true) {
        try {
            myBalance.ton = await tonClient.getBalance(walletAddress);
            myBalance.usdt = (await tonClient.runMethod(Address.parse(jettonWallets.usdt), 'get_wallet_data')).stack.readBigNumber();
            myBalance.usdc = (await tonClient.runMethod(Address.parse(jettonWallets.usdc), 'get_wallet_data')).stack.readBigNumber();
            myBalance.stton = (await tonClient.runMethod(Address.parse(jettonWallets.stton), 'get_wallet_data')).stack.readBigNumber();
            myBalance.tston = (await tonClient.runMethod(Address.parse(jettonWallets.tston), 'get_wallet_data')).stack.readBigNumber();
            break;
        } catch (e) {
            attempts++;
            if (attempts > 5) {
                throw e;
            }
            await sleep(500);
            continue
        }
    }

    return myBalance;
}

export async function handleLiquidates(db: MyDatabase, tonClient: TonClient,
    contract: ContractProvider, highloadAddress: Address,
    keys: KeyPair, bot: Bot) {
    await db.cancelOldTasks();
    const tasks = await db.getTasks();
    const myBalance = await getMyBalance(tonClient, highloadAddress);
    const log: {
        id: number,
        walletAddress: string,
    }[] = [];
    const highloadMessages = Dictionary.empty<number, Cell>();
    let i = 0;
    for (const task of tasks) {
        console.log(myBalance)
        if ((task.loanAsset === AssetID.ton && myBalance.ton < task.liquidationAmount) ||
            (task.loanAsset === AssetID.usdt && myBalance.usdt < task.liquidationAmount) ||
            (task.loanAsset === AssetID.usdc && myBalance.usdc < task.liquidationAmount) ||
            (task.loanAsset === AssetID.stton && myBalance.stton < task.liquidationAmount) ||
            (task.loanAsset === AssetID.tston && myBalance.tston < task.liquidationAmount)){

            if ((task.loanAsset === AssetID.ton && myBalance.ton < 5_000_000_000n) ||
                (task.loanAsset === AssetID.usdt && myBalance.usdt < 1_000_000n) ||
                (task.loanAsset === AssetID.usdc && myBalance.usdc < 1_000_000n) ||
                (task.loanAsset === AssetID.stton && myBalance.stton < 1_000_000_000n) ||
                (task.loanAsset === AssetID.tston && myBalance.tston < 1_000_000_000n)){
                console.log(`Not enough balance for liquidation task ${task.id}`);
                await bot.api.sendMessage(serviceChatID, `❌ Not enough balance for liquidation task ${task.id}

<b>Loan asset:</b> ${getAssetName(task.loanAsset)}
<b>Liquidation amount:</b> ${getFriendlyAmount(task.liquidationAmount, getAssetName(task.loanAsset))}
<b>My balance:</b>
<b>- TON:</b> ${getFriendlyAmount(myBalance.ton, "TON")}
<b>- USDT:</b> ${getFriendlyAmount(myBalance.usdt, "USDT")}
<b>- USDC:</b> ${getFriendlyAmount(myBalance.usdc, "USDC")}
<b>- stTON:</b> ${getFriendlyAmount(myBalance.stton, "stTON")}
<b>- tSTON:</b> ${getFriendlyAmount(myBalance.tston, "tSTON")}`, { parse_mode: 'HTML' });
                await db.cancelTaskNoBalance(task.id);
                continue;
            }

            if(task.loanAsset === AssetID.ton) {
                task.liquidationAmount = myBalance.ton - toNano(1);
            } else if (task.loanAsset === AssetID.usdt) {
                task.liquidationAmount = myBalance.usdt
            } else if (task.loanAsset === AssetID.usdc) {
                task.liquidationAmount = myBalance.usdc
            } else if (task.loanAsset === AssetID.stton) {
                task.liquidationAmount = myBalance.stton;
            } else if (task.loanAsset === AssetID.tston) {
                task.liquidationAmount = myBalance.tston;
            }
            task.minCollateralAmount = 0n;
        }

        const packedPrices = beginCell()
            .storeRef(Cell.fromBase64(task.pricesCell))
            .storeBuffer(Buffer.from(task.signature, 'hex'))
            .endCell();

        let liquidationBody = Cell.EMPTY;
        let amount = 0n;
        let destAddr: string;

        // # Liquidation Logic
        //
        // This code snippet handles liquidation logic based on the type of loan asset.
        //
        // ## TON Loan Asset
        //
        // If the loan asset is TON (TON Crystal), the following steps are performed:
        //
        // 1. Set the liquidation opcode to `0x3`.
        // 2. Store the query ID, which can be `0`.
        // 3. Store the user's wallet address (not the user SC address). This address is used to calculate the user SC address.
        // 4. Store the ID of the token to be received. It's a SHA256 HASH derived from the Jetton wallet address of the EVAA master smart contract.
        // 5. Store the minimal amount of tokens required to satisfy the liquidation.
        // 6. Set a constant value of `-1` (can always be `-1`).
        // 7. Reference the `pricessCell`, which contains prices obtainable from the IOTA NFT.
        // 8. Conclude the cell.
        //
        // Amount to send: `task.liquidationAmount`, minus `0.33` for blockchain fees. The EVAA smart contract will calculate the amount of collateral tokens to send back based on this number.
        //
        // Destination address: `evaaMaster`.
        //
        // #### Other Loan Assets
        //
        // For loan assets other than TON, the following steps are performed:
        //
        // 1. Set the jetton transfer opcode to `0xf8a7ea5`.
        // 2. Store the query ID, which can be `0`.
        // 3. Store the amount of jettons to send (The EVAA smart contract will calculate the amount of collateral tokens to send back based on this number).
        // 4. Store the address of the jetton receiver smart contract, which is the EVAA master.
        // 5. Store the address of the contract to receive leftover TONs.
        // 6. Set a bit to `0`.
        // 7. Store the TON amount to forward in a token notification (Note: Clarification needed).
        // 8. Set another bit to `1`.
        // 9. Reference a sub-cell, which replicates the TON liquidation logic.
        // 10. Conclude the main cell.
        //
        // Amount to send: `toNano('1')` for transaction chain fees (Note: Clarification needed).
        //
        // Destination address: The Jetton wallet associated with the loan asset.
        // This code provides a clear explanation of the liquidation process, with detailed comments to understand each step.

        if (task.loanAsset === AssetID.ton) {
            liquidationBody = beginCell()
                .storeUint(0x3, 32) //liquidation opcode
                .storeUint(task.queryID, 64) // queryID / can be 0
                .storeAddress(Address.parse(task.walletAddress)) // address of user that you want to liquidate (not user sc address !!! it is just user wallet address based on wich user sc address will be calculated)
                .storeAddress(highloadAddress)
                .storeUint(task.collateralAsset, 256) // id of token that you want to recive / id of token it is sha256 HASH from jetton wallet address of evaa master sc
                .storeUint(task.minCollateralAmount, 64) // minimal amount of tokens that will suttisfy you to recive back 
                .storeInt(-1, 2) // can be always -1
                .storeUint(task.liquidationAmount, 64)
                .storeRef(packedPrices) // cell with prices you can get it from our IOTA nft
                .endCell();
            // const fees = toNano('2')
            amount = task.liquidationAmount + toNano(0.5); // amount of TONs to send / based on that number minus 0.33 (for blockchain fees) evaa sc will calculate an amount of collateral tokens to send back to you (if it will be bigger than minCollateralAmount)
            destAddr = getAddressFriendly(evaaMaster);
            myBalance.ton -= amount;
        } else {
            liquidationBody = beginCell()
                .storeUint(0xf8a7ea5, 32) // jetton transfer opcode
                .storeUint(task.queryID, 64) // just query id can be 0
                .storeCoins(task.liquidationAmount) // amount of jettons to send same as with ton amount but without minus 0.33 
                .storeAddress(evaaMaster) // address of jetton reciever sc, so its evaa master
                .storeAddress(highloadAddress) // response destination to get lefted tons back
                .storeBit(0)
                .storeCoins(toNano('0.7')) //ton amount to forward in tokennotification / can be 0.33 ?
                .storeBit(1)
                .storeRef(beginCell()
                    .storeUint(0x3, 32) // our opcode
                    .storeAddress(Address.parse(task.walletAddress)) // address of user that you want to liquidate (not user sc address !!! it is just user wallet address based on wich user sc address will be calculated) 
                    .storeAddress(highloadAddress)
                    .storeUint(task.collateralAsset, 256) // asset id
                    .storeUint(task.minCollateralAmount, 64) // minimal amount of tokens that will suttisfy you to recive back  
                    .storeInt(-1, 2) // just -1
                    .storeUint(0, 64)
                    .storeRef(packedPrices) // cell with prices you can get it from our IOTA nft
                    .endCell())
                .endCell()
            amount = toNano('1'); // tons for tx chain fees  / can be 0.34 ?
            destAddr = getJettonWallet(task.loanAsset);
            if (task.loanAsset === AssetID.usdt) {
                myBalance.usdt -= task.liquidationAmount;
            } else if (task.loanAsset === AssetID.usdc) {
                myBalance.usdc -= task.liquidationAmount;
            } else if (task.loanAsset === AssetID.stton) {
                myBalance.stton -= task.liquidationAmount;
            } else if (task.loanAsset === AssetID.tston) {
                myBalance.tston -= task.liquidationAmount;
            } else {
                throw new Error("Unknown asset");
            }
        }

        highloadMessages.set(task.id, beginCell()
            .store(storeMessageRelaxed(internal({
                value: amount,
                to: destAddr,
                body: liquidationBody
            })))
            .endCell()
        );

        log.push({
            id: task.id,
            walletAddress: task.walletAddress
        });
        i++;
        if (i == 100) {
            break;
        }
    }

    if (log.length == 0) {
        return;
    }
    const queryID = crypto.randomBytes(4).readUint32BE();
    const now = Math.floor(Date.now() / 1000);
    const timeout = 60;
    const finalQueryID = (BigInt(now + timeout) << 32n) + BigInt(queryID);
    const toSign = beginCell()
        .storeUint(698983191, 32)
        .storeUint(finalQueryID, 64)
        .storeDict(highloadMessages, Dictionary.Keys.Int(16), {
                serialize: (src, buidler) => {
                    buidler.storeUint(3, 8);
                    buidler.storeRef(src);
                },
                parse: (src) => {
                    let cell = beginCell()
                        .storeUint(src.loadUint(8), 8)
                        .storeRef(src.loadRef())
                        .endCell();
                    return cell;
                }
            }
        );

    const signature = sign(toSign.endCell().hash(), keys.secretKey);
    const highloadMessageBody = beginCell()
        .storeBuffer(signature)
        .storeBuilder(toSign)
        .endCell();

    // const externalMessage = beginCell()
    //     .store(storeMessage(external({
    //         to: highloadAddress,
    //         body: highloadMessageBody
    //     })))
    //     .endCell();
    // fs.writeFileSync('externalMessage.txt', externalMessage.toBoc().toString('base64'));

    while(true) {
        try {
            await contract.external(highloadMessageBody);
        } catch(e) {
            console.log(e)
            await sleep(1000);
            continue;
        }
        break;
    }

    let logString = `\nLiquidation tasks sent for ${log.length} users:\n`;
    for (const task of log) {
        logString += `ID: ${task.id}, Wallet: ${task.walletAddress}\n`;
        await db.liquidateSent(task.id);
    }
    console.log(logString);
}
