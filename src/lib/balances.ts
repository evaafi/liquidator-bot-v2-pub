import { TON_MAINNET } from "@evaafi/sdk";
import { type Address, Dictionary, type TonClient } from "@ton/ton";
import { checkAddressState } from "../util/blockchain";
import { notDefined } from "../util/logic";
import { retry } from "../util/retry";

export type WalletBalances = Dictionary<bigint, bigint>;

export function initEmptyBalances(): WalletBalances {
  return Dictionary.empty(
    Dictionary.Keys.BigUint(256),
    Dictionary.Values.BigUint(64),
  );
}

export async function getBalances(
  tonClient: TonClient,
  walletAddress: Address,
  assetIDs: bigint[],
  jettonWallets: Map<bigint, Address>,
): Promise<WalletBalances> {
  const balancesResult = await retry<WalletBalances>(
    async (): Promise<WalletBalances> => {
      const balance: WalletBalances = initEmptyBalances();
      const tonBalance = await tonClient.getBalance(walletAddress);

      balance.set(TON_MAINNET.assetId, tonBalance);
      const res = await Promise.all(
        assetIDs.map(async (assetId): Promise<bigint> => {
          const jwAddress = jettonWallets.get(assetId);
          if (notDefined(jwAddress)) {
            return 0n; // Asset is not supported, returning 0n balance
          }

          try {
            const accountState = await checkAddressState(tonClient, jwAddress);
            if (accountState !== "active") {
              console.log(
                `${assetId}: JETTON WALLET ${jwAddress} is not active: ${accountState}`,
              );
              return 0n;
            }
          } catch (e) {
            console.error(
              `Error checking address state for asset ${assetId} at ${jwAddress}: ${e}`,
            );
            return 0n;
          }

          try {
            const _res = await tonClient.runMethod(
              jwAddress,
              "get_wallet_data",
            );
            return _res.stack.readBigNumber();
          } catch (e) {
            console.error(
              `Error getting wallet data for asset ${assetId} at ${jwAddress}: ${e}`,
            );
            return 0n;
          }
        }),
      );

      res.forEach((amount, index) => {
        balance.set(assetIDs[index], amount);
      });

      return balance;
    },
    { attempts: 10, attemptInterval: 1000 },
  );

  if (!balancesResult.ok) {
    throw new Error("Failed to get balances");
  }

  return balancesResult.value;
}
