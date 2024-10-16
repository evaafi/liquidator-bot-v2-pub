import {TonClient} from "@ton/ton";
import {Address} from "@ton/core";

type AddressState = "active" | "uninitialized" | "frozen";

export async function checkAddressState(tonClient: TonClient, address: Address): Promise<AddressState> {
    const accountState = await tonClient.getContractState(address);
    return accountState.state;
}
