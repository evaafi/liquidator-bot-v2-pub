import {Database, open} from "sqlite";
import sqlite3 from 'sqlite3';
import {Task, User} from "./types";
import {isTestnet} from "../config";

// tasks time-to-live
export const TTL = {
    pending: 60_000,
    processing: 60_000,
    sent: 300_000,
    success: 10_000,
    unsatisfied: 10_000,
    insufficient_balance: 300_000,
}

export class MyDatabase {
    private db: Database;

    constructor() {
    }

    async init() {
        this.db = await open({
            filename: isTestnet ? './database-testnet.db' : './database-mainnet.db',
            driver: sqlite3.Database
        });
        await this.db.run(`
              CREATE TABLE IF NOT EXISTS transactions(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  hash VARCHAR NOT NULL,
                  utime TIMESTAMP NOT NULL
              )
          `);

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS users(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wallet_address VARCHAR NOT NULL,
                contract_address VARCHAR UNIQUE NOT NULL,
                code_version INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                ton_principal VARCHAR NOT NULL,
                jusdt_principal VARCHAR NOT NULL,
                jusdc_principal VARCHAR NOT NULL,
                stton_principal VARCHAR NOT NULL,
                tston_principal VARCHAR NOT NULL,
                usdt_principal VARCHAR NOT NULL,
                state VARCHAR NOT NULL DEFAULT 'active'
            )
      `);

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS liquidation_tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wallet_address VARCHAR NOT NULL,
                contract_address VARCHAR NOT NULL,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                loan_asset VARCHAR NOT NULL,
                collateral_asset VARCHAR NOT NULL,
                liquidation_amount VARCHAR NOT NULL,
                min_collateral_amount VARCHAR NOT NULL,
                prices_cell TEXT NOT NULL,
                signature TEXT NOT NULL,
                query_id VARCHAR NOT NULL UNIQUE,
                state VARCHAR NOT NULL DEFAULT 'pending'
            )
        `)

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS swap_tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                token_offer VARCHAR NOT NULL,
                token_ask VARCHAR NOT NULL,
                swap_amount VARCHAR NOT NULL,
                query_id VARCHAR,
                route_id VARCHAR,
                state VARCHAR NOT NULL DEFAULT 'pending',
                status INTEGER NOT NULL DEFAULT 0
            )
        `)

    }

    async addTransaction(hash: string, utime: number) {
        await this.db.run(`
            INSERT INTO transactions(hash, utime) VALUES(?, ?)
        `, hash, utime)
    }

    async isTxExists(hash: string) {
        const result = await this.db.get(`
            SELECT * FROM transactions WHERE hash = ?
        `, hash)
        return !!result
    }

    async addUser(
        wallet_address: string, contract_address: string, code_version: number,
        created_at: number, updated_at: number, ton_principal: bigint,
        jusdt_principal: bigint, jusdc_principal: bigint, stton_principal: bigint, tston_principal: bigint, usdt_principal: bigint) {
        await this.db.run(`
            INSERT INTO users(wallet_address, contract_address, code_version, created_at, updated_at, ton_principal, jusdt_principal, jusdc_principal, stton_principal, tston_principal, usdt_principal)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, wallet_address, contract_address, code_version, created_at, updated_at, ton_principal.toString(), jusdt_principal.toString(), jusdc_principal.toString(), stton_principal.toString(), tston_principal.toString(), usdt_principal.toString())
    }

    async getUser(contract_address: string): Promise<User> {
        const result = await this.db.get(`
            SELECT * FROM users WHERE contract_address = ?
        `, contract_address);

        if (!result) return undefined;

        return {
            id: result.id,
            wallet_address: result.wallet_address,
            contract_address: result.contract_address,
            codeVersion: result.code_version,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
            tonPrincipal: BigInt(result.ton_principal),
            jusdtPrincipal: BigInt(result.jusdt_principal),
            jusdcPrincipal: BigInt(result.jusdc_principal),
            sttonPrincipal: BigInt(result.stton_principal),
            tstonPrincipal: BigInt(result.tston_principal),
            usdtPrincipal: BigInt(result.usdt_principal),
            state: result.state
        }
    }

    async updateUser(contract_address: string, code_version: number, created_at: number, updated_at,
                     tonPrincipal: bigint, jusdtPrincipal: bigint, jusdcPrincipal: bigint, sttonPrincipal: bigint, tstonPrincipal: bigint, usdtPrincipal: bigint) {
        await this.db.run(`
            UPDATE users 
            SET code_version = ?, 
                created_at = IIF(created_at > ?, ?, created_at), 
                updated_at = IIF(updated_at < ?, ?, updated_at), 
                ton_principal = ?, jusdt_principal = ?, jusdc_principal = ?, stton_principal = ?, tston_principal = ?, usdt_principal = ?
            WHERE contract_address = ?
        `, code_version, created_at, created_at, updated_at, updated_at, tonPrincipal.toString(), jusdtPrincipal.toString(), jusdcPrincipal.toString(), sttonPrincipal.toString(), tstonPrincipal.toString(), usdtPrincipal.toString(), contract_address)
    }

    async updateUserTime(contract_address: string, created_at: number, updated_at: number) {
        await this.db.run(`
            UPDATE users 
            SET created_at = IIF(created_at > ?, ?, created_at), 
                updated_at = IIF(updated_at < ?, ?, updated_at)
            WHERE contract_address = ?
        `, created_at, created_at, updated_at, updated_at, contract_address)
    }

    async getUsers() {
        const result = await this.db.all(`
            SELECT * FROM users
            WHERE state = 'active'
        `);

        const users: User[] = [];
        for (const row of result) {
            users.push({
                id: row.id,
                wallet_address: row.wallet_address,
                contract_address: row.contract_address,
                codeVersion: row.code_version,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                tonPrincipal: BigInt(row.ton_principal),
                jusdtPrincipal: BigInt(row.jusdt_principal),
                jusdcPrincipal: BigInt(row.jusdc_principal),
                sttonPrincipal: BigInt(row.stton_principal),
                tstonPrincipal: BigInt(row.tston_principal),
                usdtPrincipal: BigInt(row.usdt_principal),
                state: row.state
            });
        }

        return users;
    }

    async addTask(walletAddress: string, contractAddress: string, createdAt: number, loanAsset: bigint,
                  collateralAsset: bigint, liquidationAmount: bigint, minCollateralAmount: bigint,
                  pricesCell: string, signature: string, queryID: bigint) {
        await this.db.run(`
            INSERT INTO liquidation_tasks(wallet_address, contract_address, created_at, updated_at, loan_asset, collateral_asset, liquidation_amount, min_collateral_amount, prices_cell, signature, query_id) 
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, walletAddress, contractAddress, createdAt, createdAt, loanAsset.toString(), collateralAsset.toString(), liquidationAmount.toString(), minCollateralAmount.toString(), pricesCell, signature, queryID.toString())
    }

    async getTasks() {
        const result = await this.db.all(`
            SELECT * FROM liquidation_tasks
            WHERE state = 'pending'
        `);
        if (!result) return undefined;

        const tasks: Task[] = [];
        for (const row of result) {
            tasks.push({
                id: row.id,
                walletAddress: row.wallet_address,
                contractAddress: row.contract_address,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                loanAsset: BigInt(row.loan_asset),
                collateralAsset: BigInt(row.collateral_asset),
                liquidationAmount: BigInt(row.liquidation_amount),
                minCollateralAmount: BigInt(row.min_collateral_amount),
                pricesCell: row.prices_cell,
                signature: row.signature,
                queryID: BigInt(row.query_id),
                state: row.state
            });
        }

        return tasks;
    }

    async takeTask(id: number) {
        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'processing', updated_at = ?
            WHERE id = ?
        `, Date.now(), id)
    }

    async liquidateSent(id: number) {
        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'sent', updated_at = ?
            WHERE id = ?
        `, Date.now(), id)
    }

    async liquidateSuccess(queryID: bigint) {
        await this.db.run(`
            UPDATE liquidation_tasks
            SET state = 'success', updated_at = ?
            WHERE query_id = ?
        `, Date.now(), queryID.toString())
    }

    async getTask(queryID: bigint) {
        const result = await this.db.get(`
            SELECT * FROM liquidation_tasks
            WHERE query_id = ?
        `, queryID.toString());
        if (!result) return undefined;

        return {
            id: result.id,
            walletAddress: result.wallet_address,
            contractAddress: result.contract_address,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
            loanAsset: BigInt(result.loan_asset),
            collateralAsset: BigInt(result.collateral_asset),
            liquidationAmount: BigInt(result.liquidation_amount),
            minCollateralAmount: BigInt(result.min_collateral_amount),
            pricesCell: result.prices_cell,
            signature: result.signature,
            queryID: BigInt(result.query_id),
            state: result.state
        };
    }

    async handleFailedTasks() {
        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'failed', updated_at = ?
            WHERE state in ('sent') AND ? - updated_at > ?
        `, Date.now(), Date.now(), TTL.sent)

        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'failed', updated_at = ?
            WHERE state in ('processing') AND ? - updated_at > ?
        `, Date.now(), Date.now(), TTL.processing)

        return [];
        // TODO: rethink the blacklisting logic

        // const result = await this.db.all(`
        //     UPDATE users
        //     SET state = 'blacklist'
        //     WHERE (
        //         SELECT COUNT(*)
        //         FROM liquidation_tasks
        //         WHERE liquidation_tasks.wallet_address = users.wallet_address AND state = 'failed'
        //     ) >= 1 AND state = 'active'
        //     RETURNING users.wallet_address
        // `);
        //
        // const wallets: string[] = [];
        // for(const row of result) {
        //     wallets.push(row.wallet_address);
        // }
        //
        // return wallets;
    }

    async blacklistUser(walletAddress: string) {
        await this.db.all(`
            UPDATE users
            SET state = 'blacklist'
            WHERE users.wallet_address = ?   
        `, walletAddress);
    }

    async isTaskExists(walletAddress: string) {
        const now = Date.now();
        const result = await this.db.get(`
            SELECT * FROM liquidation_tasks 
            WHERE 
                (wallet_address = ? AND state = 'pending' AND ? - updated_at < ${TTL.pending}) OR
                (wallet_address = ? AND state = 'processing' AND ? - updated_at < ${TTL.processing}) OR
                (wallet_address = ? AND state = 'sent' AND ? - updated_at < ${TTL.sent}) OR
                (wallet_address = ? AND state = 'success' AND ? - updated_at < ${TTL.success}) OR 
                (wallet_address = ? AND state = 'unsatisfied' AND ? - updated_at < ${TTL.unsatisfied}) OR
                (wallet_address = ? AND state = 'insufficient_balance' AND ? - updated_at < ${TTL.insufficient_balance})
        `, walletAddress, now, walletAddress, now, walletAddress, now,
            walletAddress, now, walletAddress, now, walletAddress, now
        );
        return !!result;
    }

    async cancelOldTasks() {
        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'cancelled', updated_at = ?
            WHERE state = 'pending' AND ? - created_at > ?
        `, Date.now(), Date.now(), TTL.pending) // 30sec -> old
    }

    async cancelTaskNoBalance(id: number) {
        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'insufficient_balance', updated_at = ?
            WHERE id = ?
        `, Date.now(), id)
    }

    async deleteOldTasks() {
        await this.db.run(`
            DELETE FROM liquidation_tasks 
            WHERE ? - created_at >= 60 * 60 * 24 * 7 * 1000
        `, Date.now())
    }

    async unsatisfyTask(queryID: bigint) {
        await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'unsatisfied', updated_at = ?
            WHERE query_id = ?
        `, Date.now(), queryID.toString())
    }

    async addSwapTask(createdAt: number, tokenOffer: bigint, tokenAsk: bigint, swapAmount: bigint) {
        await this.db.run(`
            INSERT INTO swap_tasks(created_at, updated_at, token_offer, token_ask, swap_amount) 
            VALUES(?, ?, ?, ?, ?)
        `, createdAt, createdAt, tokenOffer.toString(), tokenAsk.toString(), swapAmount.toString())
    }
}
