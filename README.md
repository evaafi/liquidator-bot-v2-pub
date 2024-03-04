## Evaa Protocol and Hack-ton-berfest 2023

---

### **Table of Contents**

- [Understanding Evaa & Liquidation Bots](#understanding-evaa--liquidation-bots)
- [Hack-ton-berfest & Evaa Hackathon](#hack-ton-berfest--evaa-hackathon)
- [Get Involved](#get-involved)

---

### **Understanding Evaa & Liquidation Bots**

**Evaa Protocol**:
> Evaa is a decentralized financial protocol to enhance the lending and borrowing of digital assets in the DeFi space. It hinges on collateralization to ensure that loans are secure. When collateral value drops to a certain level, intervention becomes necessary.

**Liquidation Bots**:
> In DeFi, quick market downturns can put loans at risk. Liquidation bots are automated tools that vigilantly monitor the market for these vulnerable positions on platforms like Evaa. Upon detection, they automatically initiate the liquidation process. This proactive approach is vital in preserving the integrity, stability, and trustworthiness of the lending ecosystem.

---

### **Hack-ton-berfest & Evaa Hackathon**

**Hack-ton-berfest**:
> An iteration of the renowned Hacktoberfest, Hack-ton-berfest is a month-long ode to open-source software celebrated every October. Developers worldwide converge to enhance open-source projects, ensuring the software community continues to thrive and innovate.
> Link: https://society.ton.org/hack-ton-berfest-2023

**Evaa Hackathon**:
> Running parallel to Hack-ton-berfest, the Evaa Hackathon zeroes in on the creation and enhancement of liquidation bots tailored for the Evaa ecosystem. It's a pedestal for developers to manifest their skills, bring value to the rapidly evolving DeFi space, and seize opportunities for rewards and acclaim.
> Link: https://evaa.gitbook.io/evaadev/

---

### **Get Involved**

🌍 **A Global Invitation**:

We're reaching out to developers, DeFi enthusiasts, and innovative minds across the globe!

- Engage with the global open-source community via **Hack-ton-berfest**.
- Showcase your DeFi acumen and prowess through the **Evaa Hackathon**.

🔗 **Deep Dive into DeFi**:

Are you eager to unravel more about DeFi and our innovative protocol? Could you jump into the conversation on **Protocol Hub **? This hub is a nexus for vibrant discussions, creativity, and insights and serves as a direct channel to engage with the core Evaa team.

🚀 **Join the Movement**:

Don't let this golden opportunity slip away. Dive in, contribute, foster connections, and be a pivotal part of sculpting the financial future. Let's architect the next big thing in DeFi together in our Evaa Protocol Hub: https://t.me/EvaaProtocolHub

---

### **Understanding the EVAA Protocol GET Methods**

#### 1. `get_wallet_data`
- **Description**: Retrieves wallet data, such as the balance.
- **Usage**:
  ```typescript
  myBalance.usdt = (await tonClient.runMethod(jettonWallets.usdt, 'get_wallet_data')).stack.readBigNumber();
  ```
- **Arguments**: 
  - Wallet address (e.g., `jettonWallets.usdt`)
- **Return:**
```
      assetBalance = Uint(64);
```

#### 2. `getAssetsData`
- **Description**: Returns data about assets.
- **Usage**:
  ```typescript
  const assetsDataResult = await tonClient.runMethod(masterAddress, 'getAssetsData');
  ```
- **Name:** getAssetsData
- **Arguments**:
  - Master address (e.g., `masterAddress`)
- **Return:**
```
      [
        Dict<key: int256, {
          sRate = Uint(64);
          bRate = Uint(64);
          totalSupply = Uint(64);
          totalBorrow = Uint(64);
          lastAccural = Uint(32);
          balance = Uint(64);
          }>
      ] 
```


#### 3. `getAssetsConfig`
- **Description**: Returns the asset configuration.
- **Usage**:
  ```typescript
  const assetConfigResult = await tonClient.runMethod(masterAddress, 'getAssetsConfig');
  ```
- **Name:** getAssetsConfig
- **Arguments**:
  - Master address (e.g., `masterAddress`)
- **Return:**
```
      [
        Dict<key=tokenId: int256, {
          oracle = slice; 
          decimals = Uint(8); 
          collateralFactor = Uint(16); 
          liquidationThreshold = Uint(16); 
          liquidationPenalty = Uint(16); 
          baseBorrowRate = Uint(64); 
          borrowRateSlopeLow = Uint(64); 
          borrowRateSlopeHigh = Uint(64); 
          supplyRateSlopeLow = Uint(64); 
          supplyRateSlopeHigh = Uint(64); 
          targeUtilization = Uint(64);
          }>
      ]
```

#### 4. `getAllUserScData`
- **Description**: Returns all user data related to the smart contract.
- **Usage**:
  ```typescript
  userDataResult = await tonClient.runMethodWithError(userContractAddress, 'getAllUserScData');
  ```
- **Arguments**:
  - User smart contract address (e.g., `userContractAddress`)
- **Return:**
```
      [
        Dict<key=: int256,{
          codeVersion = Uint(64);
          userAddress = Uint(64);
          userPrincipals = {
            ton?: Uint(64),
            usdt?: Uint(64),
            usdc?: Uint(64),
          };
        }>
      ]
```

### **Understanding the EVAA Protocol Liquidation TX**

#### TON Loan Asset

If the loan asset is TON (TON Crystal), the following steps are performed:

1. Set the liquidation opcode to `0x3`.
2. Store the query ID, which can be `0`.
3. Store the user's wallet address (not the user SC address). This address is used to calculate the user SC address.
4. Store the ID of the token to be received. It's a SHA256 HASH derived from the Jetton wallet address of the EVAA master smart contract.
5. Store the minimal amount of tokens required to satisfy the liquidation.
6. Set a constant value of `-1` (can always be `-1`).
7. Reference the `pricessCell`, which contains prices obtainable from the IOTA NFT.
8. Conclude the cell.

Amount to send: `task.liquidationAmount`, minus `0.33` for blockchain fees. The EVAA smart contract will calculate the amount of collateral tokens to send back based on this number.

Destination address: `evaaMaster`.

#### Other Loan Assets

For loan assets other than TON, the following steps are performed:

1. Set the jetton transfer opcode to `0xf8a7ea5`.
2. Store the query ID, which can be `0`.
3. Store the amount of jettons to send (The EVAA smart contract will calculate the amount of collateral tokens to send back based on this number).
4. Store the address of the jetton receiver smart contract, which is the EVAA master.
5. Store the address of the contract to receive leftover TONs.
6. Set a bit to `0`.
7. Store the TON amount to forward in a token notification (Note: Clarification needed).
8. Set another bit to `1`.
9. Reference a sub-cell, which replicates the TON liquidation logic.
10. Conclude the main cell.

Amount to send: `toNano('1')` for transaction chain fees (Note: Clarification needed).

Destination address: The Jetton wallet associated with the loan asset.

This code provides a clear explanation of the liquidation process, with detailed comments to understand each step.

