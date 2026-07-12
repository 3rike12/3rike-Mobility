# 3rike Contracts (Arc)

Solidity contracts for 3rike, built with [Foundry](https://book.getfoundry.sh/).

## Setup

Dependencies (OpenZeppelin, forge-std) are not committed. After cloning:

```bash
cd contracts
./setup.sh          # fetches pinned OpenZeppelin v5.1.0 + forge-std v1.9.4 into lib/
forge build
forge test
```

## Deploy (Arc testnet)

```bash
cp .env.example .env   # set PRIVATE_KEY (a funded testnet deployer)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_RPC_URL" --broadcast --legacy --skip-simulation
```

## Contracts

- `ThreeRikeVault.sol` — ERC-4626 USDC yield vault (stablecoin-agnostic).

Deployed addresses: see [deployments.md](./deployments.md).
