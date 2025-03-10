import {Database, open} from "sqlite";
import sqlite3 from 'sqlite3';
import {emptyPrincipals, PrincipalsDict, Task, User} from "./types";
import {retry} from "../util/retry";
import {PoolAssetConfig} from "@evaafi/sdk";
import {makeCreateUsersScript, makeProcessUserScript} from "./helpers";

const seconds = (s: number) => s * 1000;

// tasks time-to-live
export const TTL = {
    pending: seconds(60),
    processing: seconds(60),
    sent: seconds(300),
    success: seconds(10),
    unsatisfied: seconds(10),
    insufficient_balance: seconds(300),
}

const DATABASE_RETRY_TIMEOUT = seconds(1);
const DATABASE_RETRY_ATTEMPTS = 10;
export const DATABASE_DEFAULT_RETRY_OPTIONS = {
    attempts: DATABASE_RETRY_ATTEMPTS,
    attemptInterval: DATABASE_RETRY_TIMEOUT
};

export class MyDatabase {
    protected db: Database;
    public readonly COLUMNS: string[];
    public readonly ASSET_IDS: bigint[];
    public readonly CREATE_USERS: string;
    public readonly INSERT_OR_UPDATE_USER: string;

    private fetchDbPrincipals(row: any) {
        const principals = emptyPrincipals();
        this.COLUMNS.forEach((col, index) => {
            const id = this.ASSET_IDS[index];
            const amount = row[col];
            principals.set(id, BigInt(amount).valueOf());
        });
        return principals;
    }

    constructor(poolAssetsConfig: PoolAssetConfig[]) {
        const columns = poolAssetsConfig.map(x => (x.name + '_principal').toLowerCase());
        const assetNames = poolAssetsConfig.map(x => x.name);
        const assetIds = poolAssetsConfig.map(x => x.assetId);

        this.COLUMNS = columns;
        this.ASSET_IDS = assetIds;

        console.log('ASSETS LIST: ', columns);
        console.log('ASSET NAMES: ', assetNames);
        console.log('ASSET IDS: ', assetIds);

        this.CREATE_USERS = makeCreateUsersScript(columns);
        console.log('CREATE USERS SCRIPT: ', this.CREATE_USERS);

        this.INSERT_OR_UPDATE_USER = makeProcessUserScript(columns);
        console.log('PROCESS USER SCRIPT: ', this.INSERT_OR_UPDATE_USER);
    }

    async close() {
        try {
            await this.db.close();
        } catch (e) {
            console.warn('Failed to close db.', e);
        }
    }

    async init(arg: string | Database) {
        if (typeof arg === 'string') {
            this.db = await open({
                filename: arg,
                driver: sqlite3.Database
            });
        } else {
            this.db = arg;
        }

        await this.db.run(`
              CREATE TABLE IF NOT EXISTS transactions(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  hash VARCHAR NOT NULL,
                  utime TIMESTAMP NOT NULL
              )
          `);

        await this.db.run(this.CREATE_USERS);

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
                query_id VARCHAR NOT NULL DEFAULT '0',
                route_id VARCHAR NOT NULL DEFAULT '0',
                state VARCHAR NOT NULL DEFAULT 'pending',
                status INTEGER NOT NULL DEFAULT 0,
                prices_cell VARCHAR NOT NULL DEFAULT ''
            )
        `);
        // no prices ('') means that value check will not be done

        await this.db.run(`
        CREATE TABLE IF NOT EXISTS swap_tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL,
                token_offer VARCHAR NOT NULL,
                token_ask VARCHAR NOT NULL,
                swap_amount VARCHAR NOT NULL,
                query_id VARCHAR NOT NULL DEFAULT '0',
                route_id VARCHAR NOT NULL DEFAULT '0',
                state VARCHAR NOT NULL DEFAULT 'pending',
                status INTEGER NOT NULL DEFAULT 0,
                prices_cell VARCHAR NOT NULL DEFAULT ''
            )`
        );
    }

    async addTransaction(hash: string, utime: number) {
        await retry(async () => {
            await this.db.run(
                `INSERT INTO transactions(hash, utime) VALUES(?, ?)`,
                hash, utime
            );
        }, DATABASE_DEFAULT_RETRY_OPTIONS);
    }

    async isTxExists(hash: string) {
        const res = await retry(async (): Promise<boolean> => {
            const result = await this.db.get(`SELECT * FROM transactions WHERE hash = ?`, hash)
            return !!result
        }, DATABASE_DEFAULT_RETRY_OPTIONS);
        if (!res.ok) throw (`Failed to check tx, db error`);

        return res.value;
    }

    mapPrincipals(principals: PrincipalsDict) {
        return this.ASSET_IDS.map(id => (principals.get(id) ?? 0n).toString());
    }

    async getUser(contract_address: string): Promise<User> {
        const result = await retry(async () => {
            return await this.db.get(
                `SELECT * FROM users WHERE contract_address = ?`,
                contract_address
            );
        }, DATABASE_DEFAULT_RETRY_OPTIONS);

        if (!result.ok) throw (`Failed to get user, problem with db`);
        if (!result.value) return undefined;

        const row = result.value;
        const principals = this.fetchDbPrincipals(row);
        const {id, wallet_address, code_version, created_at, updated_at, actualized_at, state} = row;
        return {
            id, wallet_address, contract_address,
            code_version, created_at, updated_at, actualized_at,
            principals, state,
        }
    }

    async updateUserTime(contract_address: string, created_at: number, updated_at: number) {
        await retry(async () => {
            await this.db.run(`
            UPDATE users 
            SET created_at = CASE WHEN created_at > ? THEN ? ELSE created_at END, 
                updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END
            WHERE contract_address = ?
        `, created_at, created_at, updated_at, updated_at, contract_address)
        }, DATABASE_DEFAULT_RETRY_OPTIONS);
    }

    async insertOrUpdateUser(user: User) {
        const _principals = this.mapPrincipals(user.principals);
        const insertParameters = [
            user.wallet_address, user.contract_address,
            user.code_version, user.created_at, user.updated_at, user.actualized_at,
            ..._principals
        ];

        const baseUpdateParameters = [
            user.actualized_at, user.code_version,  // code version
            user.created_at, user.created_at,       // created time
            user.updated_at, user.updated_at,       // updated time
            user.actualized_at, user.actualized_at, // actualized time
        ];

        const principalUpdateParameters = this.ASSET_IDS.map(
            asset_id => [user.actualized_at, (user.principals.get(asset_id) ?? 0n).toString()]
        ).flat();

        const parameters = [
            insertParameters,
            baseUpdateParameters,
            principalUpdateParameters,
        ].flat();

        await this.db.run(this.INSERT_OR_UPDATE_USER, ...parameters);
    }

    async getUsers() {
        const result = await retry(async () =>
                await this.db.all(`SELECT * FROM users WHERE state = 'active'`)
            , DATABASE_DEFAULT_RETRY_OPTIONS
        );

        if (!result.ok) throw (`Failed to get users, problem with db`);

        const users: User[] = [];
        for (const row of result.value) {
            const principals = this.fetchDbPrincipals(row);
            const {
                id,
                wallet_address,
                contract_address,
                code_version,
                created_at,
                actualized_at,
                updated_at,
                state
            } = row;
            users.push({
                id, wallet_address, contract_address,
                code_version, created_at, updated_at, actualized_at,
                principals, state,
            });
        }

        return users;
    }

    async addTask(walletAddress: string, contractAddress: string, createdAt: number, loanAsset: bigint,
                  collateralAsset: bigint, liquidationAmount: bigint, minCollateralAmount: bigint,
                  pricesCell: string, queryID: bigint) {
        await this.db.run(`
            INSERT INTO liquidation_tasks(wallet_address, contract_address, created_at, updated_at, loan_asset, 
                collateral_asset, liquidation_amount, min_collateral_amount, prices_cell, query_id
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            walletAddress, contractAddress, createdAt, createdAt,
            loanAsset.toString(), collateralAsset.toString(), liquidationAmount.toString(), minCollateralAmount.toString(),
            pricesCell, queryID.toString()
        )
    }

    async getTasks(max: number): Promise<Task[]> {
        const result = await retry(async () => {
            return await this.db.all(
                `SELECT * FROM liquidation_tasks WHERE state = 'pending' LIMIT ?`, max
            );
        }, DATABASE_DEFAULT_RETRY_OPTIONS);

        if (!result.ok) throw (`Failed to get tasks from db`);
        if (!result.value) return undefined;

        const tasks: Task[] = [];
        for (const row of result.value) {
            tasks.push({
                id: row.id,
                wallet_address: row.wallet_address,
                contract_address: row.contract_address,
                created_at: row.created_at,
                updated_at: row.updated_at,
                loan_asset: BigInt(row.loan_asset),
                collateral_asset: BigInt(row.collateral_asset),
                liquidation_amount: BigInt(row.liquidation_amount),
                min_collateral_amount: BigInt(row.min_collateral_amount),
                prices_cell: row.prices_cell,
                query_id: BigInt(row.query_id),
                state: row.state
            });
        }

        return tasks;
    }

    async takeTask(id: number) {
        const res = await retry(async () => await this.db.run(`
            UPDATE liquidation_tasks SET state = 'processing', updated_at = ? WHERE id = ?`, Date.now(), id),
            DATABASE_DEFAULT_RETRY_OPTIONS
        );
        if (!res.ok) throw (`Failed to update task status to 'processing'`);
    }

    async liquidateSent(id: number) {
        const res = await retry(async () => await this.db.run(`
            UPDATE liquidation_tasks SET state = 'sent', updated_at = ? WHERE id = ? `, Date.now(), id),
            DATABASE_DEFAULT_RETRY_OPTIONS);
        if (!res.ok) throw (`Failed to update task status to 'sent'`);
    }

    async liquidateSuccess(queryID: bigint) {
        const res = await retry(async () => await this.db.run(`
            UPDATE liquidation_tasks SET state = 'success', updated_at = ? WHERE query_id = ? `,
            Date.now(), queryID.toString()
        ), DATABASE_DEFAULT_RETRY_OPTIONS);
        if (!res.ok) throw (`Failed to update task status to 'success'`);
    }

    async getTask(queryID: bigint): Promise<Task> {
        const result = await retry(
            async () => await this.db.get(
                `SELECT * FROM liquidation_tasks WHERE query_id = ?`, queryID.toString()
            ), DATABASE_DEFAULT_RETRY_OPTIONS);

        if (!result.ok) throw (`Failed to get task from db`);

        const task = result.value;
        if (!task) return undefined;

        return {
            id: task.id,
            wallet_address: task.wallet_address,
            contract_address: task.contract_address,
            created_at: task.created_at,
            updated_at: task.updated_at,
            loan_asset: BigInt(task.loan_asset),
            collateral_asset: BigInt(task.collateral_asset),
            liquidation_amount: BigInt(task.liquidation_amount),
            min_collateral_amount: BigInt(task.min_collateral_amount),
            prices_cell: task.prices_cell,
            query_id: BigInt(task.query_id),
            state: task.state
        };
    }

    async handleFailedTasks() {
        const oldSentTasksRes = await retry(
            async () => await this.db.all(`
            UPDATE liquidation_tasks 
            SET state = 'failed', updated_at = ?
            WHERE state in ('sent') AND ? - updated_at > ?
        `, Date.now(), Date.now(), TTL.sent),
            DATABASE_DEFAULT_RETRY_OPTIONS
        );
        if (!oldSentTasksRes.ok) {
            // not critical, just continue working
            console.log('FAILED TO HANDLE OLD SENT TASKS');
        }

        const oldProcessingTasksRes = await retry(
            async () => await this.db.run(`
            UPDATE liquidation_tasks 
            SET state = 'failed', updated_at = ?
            WHERE state in ('processing') AND ? - updated_at > ?
        `, Date.now(), Date.now(), TTL.processing),
            DATABASE_DEFAULT_RETRY_OPTIONS
        );
        if (!oldProcessingTasksRes.ok) {
            // not critical, just continue working
            console.log('FAILED TO HANDLE OLD SENT TASKS');
        }
    }

    async blacklistUser(walletAddress: string) : Promise<boolean> {
        const res = await retry(async () => await this.db.all(`
            UPDATE users SET state = 'blacklist' WHERE users.wallet_address = ?   
        `, walletAddress), DATABASE_DEFAULT_RETRY_OPTIONS);
        return res.ok;
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

    async cancelTask(taskId: number) {
        await this.db.run(`
            UPDATE liquidation_tasks
            SET state = 'cancelled', updated_at = ?,
            WHERE id = ? 
        `, Date.now(), taskId)
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

    async addSwapTask(createdAt: number, tokenOffer: bigint, tokenAsk: bigint, swapAmount: bigint, pricesCell: string) {
        await this.db.run(`INSERT INTO swap_tasks 
            (created_at, updated_at, token_offer, token_ask, swap_amount, prices_cell) 
            VALUES(?, ?, ?, ?, ?, ?)`,
            createdAt, createdAt, tokenOffer.toString(), tokenAsk.toString(), swapAmount.toString(), pricesCell)
    }
}
