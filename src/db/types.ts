export type User = {
    id: number,
    wallet_address: string,
    contract_address: string,
    codeVersion: number,
    createdAt: number,
    updatedAt: number,
    tonPrincipal: bigint,
    usdtPrincipal: bigint,
    usdcPrincipal: bigint,
    state: string
}

export type Task = {
    id: number;
    walletAddress: string;
    contractAddress: string;
    createdAt: number;
    updatedAt: number;
    loanAsset: bigint;
    collateralAsset: bigint;
    liquidationAmount: bigint;
    minCollateralAmount: bigint;
    pricesCell: string;
    signature: string;
    queryID: bigint;
    state: string;
}