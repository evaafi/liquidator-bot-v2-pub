# Liquidation Logic

        This code snippet handles liquidation logic based on the type of loan asset.

        ## TON Loan Asset

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