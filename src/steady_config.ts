import {sha256Hash} from "./util/crypto";

export const ASSET_ID = {
    TON:            sha256Hash('TON'),
    USDT:           sha256Hash('USDT'),
    jUSDT:          sha256Hash('jUSDT'),
    jUSDC:          sha256Hash('jUSDC'),
    stTON:          sha256Hash('stTON'),
    tsTON:          sha256Hash('tsTON'),
    TONUSDT_DEDUST: sha256Hash('TONUSDT_DEDUST'),
    TONUSDT_STONFI: sha256Hash('TONUSDT_STONFI'),
    TON_STORM:      sha256Hash('TON_STORM'),
    USDT_STORM:     sha256Hash('USDT_STORM'),
    time:           sha256Hash('time'),
};

export const COLLATERAL_SELECT_PRIORITY = new Map<bigint, number>([
        [ASSET_ID.USDT,             1],
        [ASSET_ID.TON,              2],
        [ASSET_ID.stTON,            3],
        [ASSET_ID.jUSDT,            4],
        [ASSET_ID.tsTON,            5],
        [ASSET_ID.jUSDC,            6],
        [ASSET_ID.TONUSDT_DEDUST,   7],
        [ASSET_ID.TONUSDT_STONFI,   8],
        [ASSET_ID.TON_STORM,        9],
        [ASSET_ID.USDT_STORM,       10],
    ]
);
export const NO_PRIORITY_SELECTED = 999;

// assets banned from being swapped from
export const BANNED_ASSETS_FROM = [
    // ASSET_ID.tsTON,
    ASSET_ID.jUSDC
];
// assets banned from being swapped to
export const BANNED_ASSETS_TO = [
    // ASSET_ID.tsTON,
    ASSET_ID.jUSDC
];
export const LT_SCALE: bigint = 10_000n;
export const LB_SCALE: bigint = 10_000n;

//  lower bound of asset worth to swap
export const PRICE_ACCURACY: bigint = 1_000_000_000n;   // 10^9
export const MIN_WORTH_SWAP_LIMIT: bigint = 100n * PRICE_ACCURACY; // usd

// should cancel liquidation if amount is less than that number
export const LIQUIDATION_BALANCE_LIMITS = new Map<bigint, bigint>([
    [ASSET_ID.TON,              5_000_000_000n],
    [ASSET_ID.jUSDT,            1_000_000n],
    [ASSET_ID.jUSDC,            1_000_000n],
    [ASSET_ID.stTON,            1_000_000_000n],
    [ASSET_ID.tsTON,            1_000_000_000n],
    [ASSET_ID.USDT,             1_000_000n],
    [ASSET_ID.TONUSDT_DEDUST,   1_000_000_000n],
    [ASSET_ID.TONUSDT_STONFI,   1_000_000_000n],
    [ASSET_ID.TON_STORM,        1_000_000_000n],
    [ASSET_ID.USDT_STORM,       1_000_000_000n],
]);

// worth of 100$ - important constant for making decision about liquidation amount
export const LIQUIDATION_STRATEGIC_LIMIT = 100_000_000_000n;
