import "dotenv/config";

import { mnemonicToWalletKey } from "@ton/crypto";
import {
  Address,
  beginCell,
  Cell,
  contractAddress,
  Dictionary,
  internal,
  type StateInit,
  storeMessageRelaxed,
  TonClient,
  toNano,
  WalletContractV4,
} from "@ton/ton";
import {
  DEFAULT_SUBWALLET_ID,
  HIGHLOAD_CODE_V2,
  HighloadWalletV2,
} from "../src/lib/highload_contract_v2";

const TON_CLIENT = new TonClient({
  endpoint: "https://toncenter.com/api/v2/jsonRPC",
  apiKey: process.env.TONCENTER_API_KEY,
});

const WORKCHAIN = 0;

function createTransferMessage(
  to: Address,
  value: bigint,
  body: Cell = Cell.EMPTY,
): Cell {
  return beginCell()
    .store(
      storeMessageRelaxed(
        internal({
          value,
          to,
          body,
        }),
      ),
    )
    .endCell();
}

async function deployHWV2() {
  if (!process.env.WALLET_PRIVATE_KEY) {
    throw new Error("WALLET_PRIVATE_KEY environment variable is required");
  }
  if (!process.env.TONCENTER_API_KEY) {
    throw new Error("TONCENTER_API_KEY environment variable is required");
  }

  const WALLET_KEY_PAIR = await mnemonicToWalletKey(
    process.env.WALLET_PRIVATE_KEY.split(" "),
  );

  const WALLET_CONTRACT = TON_CLIENT.open(
    WalletContractV4.create({
      workchain: WORKCHAIN,
      publicKey: WALLET_KEY_PAIR.publicKey,
    }),
  );

  const HWV2_STATE: StateInit = {
    code: HIGHLOAD_CODE_V2,
    data: beginCell()
      .storeUint(DEFAULT_SUBWALLET_ID, 32)
      .storeUint(0, 64)
      .storeBuffer(WALLET_KEY_PAIR.publicKey)
      .storeBit(0)
      .endCell(),
  };

  const HWV2_ADDRESS = contractAddress(WORKCHAIN, HWV2_STATE);

  await WALLET_CONTRACT.sender(WALLET_KEY_PAIR.secretKey).send({
    to: HWV2_ADDRESS,
    init: HWV2_STATE,
    value: toNano("0.5"),
  });

  const hwv2 = new HighloadWalletV2(
    TON_CLIENT,
    HWV2_ADDRESS,
    WALLET_KEY_PAIR.publicKey,
    DEFAULT_SUBWALLET_ID,
  );

  const highloadMessages = Dictionary.empty<number, Cell>();

  highloadMessages.set(
    0,
    createTransferMessage(
      WALLET_CONTRACT.address,
      toNano("0.01"),
    ),
  );

  const messagesId = await hwv2.sendMessages(
    highloadMessages,
    WALLET_KEY_PAIR.secretKey,
  );
  console.log(messagesId);
}

deployHWV2();
