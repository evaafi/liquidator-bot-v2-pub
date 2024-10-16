import {Dictionary} from "@ton/ton";

export type PrincipalsDict = Dictionary<bigint, bigint>;
export const emptyPrincipals = () => Dictionary.empty<bigint, bigint>();

export type User = {
    id: number,
    wallet_address: string,
    contract_address: string,
    code_version: number,
    created_at: number,
    updated_at: number,
    actualized_at: number,
    principals: PrincipalsDict,
    state: string
}

export type Task = {
    id: number;
    wallet_address: string;
    contract_address: string;
    created_at: number;
    updated_at: number;
    loan_asset: bigint;
    collateral_asset: bigint;
    liquidation_amount: bigint;
    min_collateral_amount: bigint;
    prices_cell: string;
    query_id: bigint;
    state: string;
}
