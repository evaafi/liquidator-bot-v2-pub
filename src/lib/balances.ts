import {Address, Dictionary, TonClient} from "@ton/ton";
import {retry} from "../util/retry";
import {notDefined} from "../util/logic";
import {checkAddressState} from "../util/blockchain";
import {TON_MAINNET} from "@evaafi/sdkv6";

export type WalletBalances = Dictionary<bigint, bigint>;

export function initEmptyBalances(): WalletBalances {
    return Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.BigUint(64));
}

export async function getBalances(
    tonClient: TonClient,
    walletAddress: Address,
    assetIDs: bigint[],
    jettonWallets: Map<bigint, Address>
): Promise<WalletBalances> {
    const balancesResult = await retry<WalletBalances>(async (): Promise<WalletBalances> => {
        const balance: WalletBalances = initEmptyBalances();
        const tonBalance = await tonClient.getBalance(walletAddress);

        balance.set(TON_MAINNET.assetId, tonBalance);
        const res = await Promise.all(
            assetIDs.map(async (assetId): Promise<bigint> => {
                const jwAddress = jettonWallets.get(assetId);
                if (notDefined(jwAddress)) throw new Error(`Asset ${assetId} is not supported`);

                const accountState = await checkAddressState(tonClient, jwAddress);
                if (accountState !== 'active') {
                    console.log(`${assetId}: JETTON WALLET ${jwAddress} is not active: ${accountState}`);
                    return 0n;
                }

                const _res = await tonClient.runMethod(jwAddress, 'get_wallet_data');
                return _res.stack.readBigNumber();
            })
        );

        res.forEach((amount, index) => {
            balance.set(assetIDs[index], amount);
        })

        return balance;
    }, {attempts: 5, attemptInterval: 500});

    if (!balancesResult.ok) {
        throw new Error("Failed to get balances");
    }

    return balancesResult.value;
}
