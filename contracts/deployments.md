# 3rike — Arc Testnet deployments (chain 5042002)

Explorer: https://testnet.arcscan.app · USDC faucet: https://faucet.circle.com

| Contract | Address |
|---|---|
| Circle USDC (canonical, native gas token) | `0x3600000000000000000000000000000000000000` |
| TricycleNFT (ERC-721) | `0x0664D429118f07723deb5Bb218ac393D01850411` |
| FractionalInvestment (ERC-1155 + accumulator yield) | `0xc2147d515A00474Ff3d5dAd32df9A9f6522677af` |
| ThreeRikeVault (ERC-4626, optional) | _not yet deployed to Arc_ |
| Treasury / relayer (owner) | `0xCc7335908600615cEAC17AB5FA4F779B042847D3` |

**Deployed to Arc testnet 2026-07-01.** 2 tricycles seeded (RDB-001 Bajaj RE $2,500/125 shares, RDB-002 Mahindra Treo $2,800/140 shares), pools open at **$1/share** (asset price unchanged; invest from $1). Verified on-chain (nextId=3, pool 1 active).

Demo tricycles (seeded by `DeployInvestment.s.sol`), pools open at **$1/share**:
- RDB-001 Bajaj RE — **$2,500** (2500 shares @ $1), **non-EV** (renders as yellow tricycle)
- RDB-002 Mahindra Treo — **$2,800** (2800 shares @ $1), **EV**

Rider repayment model: ~$70/wk per tricycle; investor slice $9/$11 per week → ~19/20% APR (derived in `backend/src/lib/catalog.ts`).

## Deploy to Arc
```bash
cd contracts && ./setup.sh && forge build
# fund the deployer (PRIVATE_KEY) with testnet USDC from faucet.circle.com (USDC = gas)
forge script script/DeployInvestment.s.sol:DeployInvestment \
  --rpc-url "$ARC_RPC_URL" --broadcast --legacy --skip-simulation
```
Then set `TRICYCLE_NFT_ADDRESS` + `INVESTMENT_ADDRESS` (and `VAULT_ADDRESS`) in `backend/.env` / Railway.

> Contracts are unchanged from the EVM build: they use `IERC20(usdc)`, and Arc's
> canonical USDC ERC-20 (`0x3600…0000`, 6 decimals) drops in directly. USDC is
> Circle-issued (no open mint), so the backend funds wallets via real transfers.

**Prior Robinhood Chain deploys (superseded):** ThreeRikeVault `0x34979dF7570697feB152468C3A17a51d0B9a34ED`; TricycleNFT `0x64b84997414F7Bb301B5e6A2E228066e27C7EDd0` / FractionalInvestment `0xBBE7ECa80d91e26E24A9f498B15239a5D975542B` (chain 46630, mock USDC `0x5B6C…26f5`).
