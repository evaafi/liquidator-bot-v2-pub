import {TupleReader} from "@ton/core";

export type GetResult = {
    gas_used: number;
    stack: TupleReader;
    exit_code: number;
};

export type UserPrincipals = {
    ton: bigint,
    jusdt: bigint,
    jusdc: bigint,
    stton: bigint,
    tston: bigint,
    usdt: bigint
}