import { Address } from "@ton/core";
import { sha256Hash } from "./util/crypto";

import {
  ASSET_ID as _ASSET_ID,
  MAINNET_ALTS_POOL_CONFIG,
  MAINNET_LP_POOL_CONFIG,
  MAINNET_POOL_CONFIG,
  MAINNET_STABLE_POOL_CONFIG,
} from "@evaafi/sdk";

export const ASSET_ID = {
  ..._ASSET_ID,
  time: sha256Hash("time"),
};

/**
 * Priority order of collaterals to select for calculating liquidation parameters
 */
export const COLLATERAL_SELECT_PRIORITY = new Map<bigint, number>([
  [ASSET_ID.USDT, 1],
  [ASSET_ID.USDe, 2],
  [ASSET_ID.tsUSDe, 3],
  [ASSET_ID.TON, 4],
  [ASSET_ID.stTON, 5],
  [ASSET_ID.jUSDT, 6],
  [ASSET_ID.tsTON, 7],
  [ASSET_ID.jUSDC, 8],
  [ASSET_ID.TONUSDT_DEDUST, 9],
  [ASSET_ID.TONUSDT_STONFI, 10],
  [ASSET_ID.TON_STORM, 11],
  [ASSET_ID.USDT_STORM, 12],
  [ASSET_ID.NOT, 13],
  [ASSET_ID.DOGS, 14],
  [ASSET_ID.CATI, 15],
  [ASSET_ID.PT_tsUSDe_01Sep2025, 16],
  [ASSET_ID.PT_tsUSDe_18Dec2025, 17],
]);
export const NO_PRIORITY_SELECTED = 999;

/**
 * lower bound of asset worth to swap
 */
export const PRICE_ACCURACY: bigint = 1_000_000_000n; // 10^9
export const MIN_WORTH_SWAP_LIMIT: bigint = 100n * PRICE_ACCURACY; // usd

/**
 * should cancel liquidation if amount is less than that number
 */
export const LIQUIDATION_BALANCE_LIMITS = new Map<bigint, bigint>([
  [ASSET_ID.TON, 5_000_000_000n],
  [ASSET_ID.jUSDT, 1_000_000n],
  [ASSET_ID.jUSDC, 1_000_000n],
  [ASSET_ID.stTON, 1_000_000_000n],
  [ASSET_ID.tsTON, 1_000_000_000n],
  [ASSET_ID.USDT, 1_000_000n],
  [ASSET_ID.USDe, 1_000_000n],
  [ASSET_ID.tsUSDe, 1_000_000n],
  [ASSET_ID.TONUSDT_DEDUST, 1_000_000_000n],
  [ASSET_ID.TONUSDT_STONFI, 1_000_000_000n],
  [ASSET_ID.TON_STORM, 1_000_000_000n],
  [ASSET_ID.USDT_STORM, 1_000_000_000n],
  [ASSET_ID.NOT, 1_000_000_000n],
  [ASSET_ID.DOGS, 1_000_000_000n],
  [ASSET_ID.CATI, 1_000_000_000n],
]);

/**
 * EVAA contract versions
 */

export const EVAA_CONTRACT_VERSIONS_MAP = new Map<
  Address,
  {
    name: string;
    v4_upgrade_lt: number;
    v9_upgrade_lt: number;
  }
>([
  [
    MAINNET_POOL_CONFIG.masterAddress,
    {
      name: "Main pool",
      v4_upgrade_lt: 49828980000001,
      v9_upgrade_lt: 61426459000001,
    },
  ],
  [
    MAINNET_LP_POOL_CONFIG.masterAddress,
    {
      name: "LP pool",
      v4_upgrade_lt: 49712577000001,
      v9_upgrade_lt: 61359759000001,
    },
  ],
  [
    MAINNET_ALTS_POOL_CONFIG.masterAddress,
    {
      name: "Alts pool",
      v4_upgrade_lt: 0,
      v9_upgrade_lt: 61187409000001,
    },
  ],
  [
    MAINNET_STABLE_POOL_CONFIG.masterAddress,
    {
      name: "Stable pool",
      v4_upgrade_lt: 0,
      v9_upgrade_lt: 61359759000001,
    },
  ],
]);
/**
 * assets banned from being swapped from
 */
export const BANNED_ASSETS_FROM = [ASSET_ID.jUSDC];

/**
 * assets banned from being swapped to
 */
export const BANNED_ASSETS_TO = [ASSET_ID.jUSDC];

/**
 * should we skip value check when assigning a swap task?
 */
export const SKIP_SWAP_VALUE_CHECK = false;

/**
 * liquidator prices update interval in seconds
 */
export const LIQUIDATOR_PRICES_UPDATE_INTERVAL = 15;

/**
 * validator price actuality time since issued,validator receives price data from sdk,
 * if this value is exceeded, there might be something wrong with sdk
 */
export const VALIDATOR_MAX_PRICES_ISSUED = 136;

/**
 * liquidator price actuality time since issued
 */
export const LIQUIDATOR_MAX_PRICES_ISSUED = 150;
