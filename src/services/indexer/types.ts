import {TupleReader} from "@ton/core";

export type GetResult = {
    gas_used: number;
    stack: TupleReader;
    exit_code: number;
};

export type LiquidationAssetsInfo = {
    loanAssetName: string,
    loanAssetDecimals: bigint,
    collateralAssetName: string,
    collateralAssetDecimals: bigint
}
