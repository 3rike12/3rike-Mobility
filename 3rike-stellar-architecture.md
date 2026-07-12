# 3riKE × Stellar: Technical Architecture

### The Financial Operating System for Africa's Electric Mobility Economy
**A non-custodial, chat-simple lease-to-own + fractional-RWA + savings + credit platform built on Stellar & Soroban.**

> Prepared for the Stellar Community Fund — **Integration Track**. This document specifies the
> complete Stellar integration architecture that turns the live 3rike.xyz UI into a production
> fintech on Stellar. The product logic (fractional ownership, automated yield, credit scoring,
> lease-to-own progress, savings) is already designed and proven; this architecture maps it onto
> Stellar's native primitives — SEP standards, Soroban smart contracts, USDC, sponsored
> transactions, anchors, oracles, and DeFi composability.

---

## 1. System Architecture Overview

3riKE is a **rider- and investor-facing** platform. Riders lease-to-own electric three-wheelers with
weekly USDC payments and build a portable credit identity; investors fund those vehicles as
fractional real-world assets and receive automated, transparent yield. Everything settles on
Stellar for low fees, fast finality, and verifiable, composable ownership records.

The system is composed of a **React/Vite PWA** (rider + investor portals), a **Node.js/TypeScript
API layer** with Postgres, a **Sovereign Key Security Layer** (AES-256-GCM + PIN, with an optional
passkey smart-wallet path), and a set of **Stellar Integration Providers**: Horizon + Soroban RPC,
the **3riKE Soroban contract suite** (RWA vault, lease-to-own escrow, yield distributor, savings,
credit registry), **anchors** (SEP-6/24) for GHS↔USDC, **Bridge (Stripe)** stablecoin orchestration,
the **Reflector oracle**, and DeFi composability (**DeFindex**, **Soroswap**, **Blend**).

### 1.1 High-Level System Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │        CLIENT (React/Vite PWA)              │
                         │  Rider Portal · Investor Portal · Savings   │
                         │  Onboarding · Wallet · Confirmation Drawer  │
                         └───────────────┬─────────────────────────────┘
                                         │  HTTPS / JWT (SEP-10 session)
                         ┌───────────────▼─────────────────────────────┐
                         │     BACKEND API  (Node.js / TypeScript)     │
                         │  services: lease · invest · savings ·       │
                         │  credit · rider · anchor · bridge           │
                         └───┬─────────────┬───────────────┬───────────┘
                             │             │               │
              ┌──────────────▼──┐  ┌───────▼───────┐  ┌────▼────────────┐
              │ SOVEREIGN KEY    │  │ POSTGRES      │  │ STELLAR ACCESS  │
              │ SECURITY LAYER   │  │ (ledger index │  │ Horizon + Soroban│
              │ AES-256-GCM+PIN  │  │  + app state) │  │ RPC clients      │
              │ (or Passkey SW)  │  └───────────────┘  └────┬─────────────┘
              └──────────────────┘                          │
        ┌───────────────┬───────────────┬──────────────┬────┴──────┬───────────────┐
        ▼               ▼               ▼              ▼           ▼               ▼
 ┌────────────┐  ┌────────────┐  ┌────────────┐ ┌───────────┐ ┌─────────┐  ┌──────────────┐
 │ 3riKE       │  │ ANCHORS    │  │ BRIDGE      │ │ REFLECTOR │ │ DeFindex│  │ SOROSWAP /   │
 │ SOROBAN     │  │ SEP-6/24   │  │ (Stripe)    │ │ ORACLE    │ │ (savings│  │ BLEND        │
 │ CONTRACT    │  │ SEP-10/38  │  │ Stablecoin  │ │ FX + RWA  │ │ yield)  │  │ (swaps /     │
 │ SUITE       │  │ SEP-12 KYC │  │ Orchestr.   │ │ perf feed │ │         │  │  rider credit)│
 └────────────┘  └────────────┘  └────────────┘ └───────────┘ └─────────┘  └──────────────┘
   RWA vault ·      GHS ⇄ USDC       fiat ⇄ USDC    price/credit   real yield    DeFi rails
   lease escrow ·   local rails      cross-border    inputs
   yield · savings ·
   credit registry
```

**Design principles:** (1) *Non-custodial by default* — users never see a seed phrase, keys are
client-encrypted; (2) *Gas-abstracted* — riders never buy XLM (sponsored reserves + fee bumps);
(3) *Everything verifiable* — ownership %, repayments, and yield live on-chain via Soroban events;
(4) *Composable* — 3riKE assets and contracts are standard (SEP-41) so the ecosystem can build on them.

---

## 2. Integration Layer Architecture

Stellar integration is organised into reusable business logic (`lib/stellar`), domain services,
thin HTTP routes, and the Soroban contract workspace.

```
backend/src/
├── lib/stellar/
│   ├── horizon.ts        # Horizon + Soroban RPC clients, network passphrase, SAC helpers
│   ├── keys.ts           # Keypair gen, AES-256-GCM envelope (PBKDF2), sign-in-memory
│   ├── sponsor.ts        # Sponsored reserves (account creation) + fee-bump gas abstraction
│   ├── soroban.ts        # Build / simulate / assemble / submit Soroban invocations; auth entries
│   ├── contracts.ts      # Typed client bindings for the 3riKE contract suite
│   ├── anchors.ts        # SEP-10 auth · SEP-6/24 deposit-withdraw · SEP-38 quotes · SEP-12 KYC
│   ├── bridge.ts         # Bridge (Stripe) Stablecoin Orchestration API client
│   ├── reflector.ts      # Reflector oracle reader (FX GHS/USD, asset-performance feed)
│   └── passkey.ts        # (optional) Passkey smart-wallet (Soroban) deploy + policy signer
├── services/            # lease · invest · savings · credit · rider · anchor · bridge (domain logic)
└── routes/              # /stellar/wallet · /anchor · /lease · /invest · /savings · /credit · /bridge
│
contracts/ (Soroban · Rust)
├── tricycle_vault/       # RWA tokenization + fractional shares (SEP-41 token interface)
├── lease_to_own/         # Escrow + weekly milestone tracking + ownership progression
├── yield_distributor/    # Accumulator-based, pro-rata investor yield (claimable)
├── savings/              # Target & Lock accounts with penalty logic
└── credit_registry/      # On-chain repayment history (oracle-ready, portable credit)
│
frontend/ (React + Vite PWA)
├── rider portal · investor portal · savings dashboard · onboarding · wallet · confirmation drawer
```

---

## 3. Non-Custodial Wallets & Frictionless Onboarding

The single biggest onboarding barrier for non-crypto riders is wallet + gas complexity. 3riKE removes
both: an account is created and funded **for** the user on signup, with **zero XLM** ever required.

### 3.1 Account Creation via Sponsored Reserves

Stellar's **Sponsored Reserves (CAP-33)** let 3riKE's sponsor account pay the base reserve and
trustline reserves for a brand-new rider — so the rider's account exists and can hold USDC without
the rider owning any XLM.

```
Signup ─► generate Stellar keypair (client) ─► encrypt seed (AES-256-GCM + PIN)
      ─► POST /stellar/wallet  ─► backend builds a SPONSORED account-creation tx:
            beginSponsoringFutureReserves(sponsor)
              → createAccount(newRider, 0 XLM)
              → changeTrust(USDC)            // trustline reserve sponsored
              → changeTrust(3RIKE-SHARE)     // fractional-share asset, sponsored
            endSponsoringFutureReserves()
      ─► sponsor signs + submits ─► rider is live, holds USDC, owns zero XLM.
```

### 3.2 Gas Abstraction via Fee-Bump Transactions (CAP-15)

Every user action (pay lease, invest, save, claim yield) is signed locally by the rider, then wrapped
in a **fee-bump envelope** signed by 3riKE's fee-sponsor hot wallet. The user pays **zero XLM**; 3riKE
covers the network fee and can meter a micro-fee in USDC.

```
Rider signs inner tx (USDC payment / contract invoke)
      → POST /stellar/wallet/broadcast
      → backend wraps in FeeBumpTransaction { feeSource: sponsor }  → sponsor signs outer
      → submit to Horizon/Soroban RPC → rider paid 0 XLM.
```

### 3.3 Sovereign Key Security Model

```
PIN (6-digit) ──PBKDF2-HMAC-SHA256 (600k iters)──► 256-bit key
Seed phrase ──AES-256-GCM (auth tag)──► { encryptedSeed, iv, salt }  (only this is stored)
Signing: decrypt in-memory only, sign locally, return signed XDR; seed never persists/transits.
```

### 3.4 Optional Upgrade — Passkey Smart Wallets *(differentiator vs. a plain seed model)*

For a truly seedless experience, 3riKE can deploy a **Soroban passkey smart-wallet** per user:
device-bound WebAuthn passkeys authorise contract calls, with 3riKE as an optional recovery/policy
signer. This gives biometric, phishing-resistant onboarding with no PIN or seed at all — ideal for
low-literacy, mobile-first riders — while keeping the classic encrypted-key path as a fallback.

---

## 4. The 3riKE Soroban Contract Suite (Core RWA Financial Engine)

This is the heart of the platform and the majority of the integration work. Five composable Soroban
contracts turn a physical tricycle into a transparent, financeable, co-owned asset. USDC is used
inside Soroban via its **Stellar Asset Contract (SAC)** wrapper.

### 4.1 `tricycle_vault` — RWA Tokenization + Fractional Shares (SEP-41)
- Mints one **asset record per real vehicle** (make, model, VIN, price, battery/range metadata).
- Issues fungible **shares** implementing the **SEP-41 token interface** (`transfer`, `balance`,
  `approve`), so investor ownership is a standard, composable token the whole ecosystem can read.
- Tracks `total_shares`, `shares_sold`, and per-holder balances; emits `ShareMinted` / `Transfer` events.

### 4.2 `lease_to_own` — Escrow + Milestone Tracking
- Binds a **rider ↔ vehicle** with a weekly schedule (e.g. ~$70/wk toward a ~$4,900 lease-to-own price).
- Each weekly USDC payment is split on-chain: **principal → ownership progress**, **yield slice →
  investors**, **platform/maintenance**. Ownership % advances deterministically and verifiably.
- Handles **arrears/default logic** and exposes `ownership_bps(rider)` for the UI's progress bar.
- Emits `PaymentMade`, `OwnershipAdvanced`, `Delinquent` events for indexing.

### 4.3 `yield_distributor` — Automated, Pro-Rata Investor Yield
- Accumulator pattern (`acc_yield_per_share`) so distribution is **O(1)** regardless of investor count.
- On each rider payment, the yield slice is distributed to that vehicle's shareholders **pro-rata**.
- Investors **claim** to their wallet — implemented via **Stellar Claimable Balances** so yield is a
  first-class, conditionally-claimable on-ledger object (auditable, revocable on refund).

### 4.4 `savings` — Target & Lock Accounts (Inflation Protection)
- **Target**: goal-based USDC saving with progress tracking. **Lock**: time-locked USDC with an
  **early-withdrawal penalty** enforced in-contract.
- Optional yield routing to **DeFindex** index pools (see §9) so idle savings earn real USDC yield.

### 4.5 `credit_registry` — Portable, Oracle-Ready Credit History
- Records every on-time/late repayment as immutable on-chain history → a **mobility-based credit
  score**. Exposed as an **oracle-ready** feed other lenders (and 3riKE's own loan product) can consume.
- Enables future under-collateralised lending via **Blend** (see §9) using verifiable repayment data.

### 4.6 The On-Chain Loop (what makes 3riKE composable, not just custodial)

```
        buys shares (USDC)                     weekly USDC payment
 ┌────────────┐  ───────────────►  ┌───────────────────┐  ───────────────►  ┌──────────┐
 │ INVESTORS  │                    │  tricycle_vault    │                    │  RIDER   │
 │ SEP-41     │  ◄───────────────  │  + lease_to_own    │  ◄───────────────  │ leases   │
 │ shareholders│  pro-rata yield   │  + yield_distributor│  ownership % ▲     │ to own   │
 └────────────┘  (Claimable Bal.)  └─────────┬──────────┘  credit score ▲    └──────────┘
                                             │ emits events
                                    ┌────────▼─────────┐
                                    │  credit_registry  │──► oracle-ready score ──► Blend lending
                                    └───────────────────┘
```

---

## 5. Anchors & On/Off-Ramps — GHS ⇄ USDC (SEP-6, SEP-24, SEP-10, SEP-38, SEP-12)

To let riders and investors fund and cash out with **familiar local rails** (mobile money, bank),
3riKE integrates Africa-friendly Stellar anchors using the full SEP ramp stack.

- **SEP-10** — cryptographic challenge/response auth; the resulting JWT also seeds the app session.
- **SEP-38** — live, transparent **GHS↔USDC quotes** shown before the user commits.
- **SEP-24** — hosted, interactive deposit/withdraw (KYC + payment in an anchor-served iframe).
- **SEP-6** — programmatic deposit/withdraw for streamlined/returning flows where the anchor supports it.
- **SEP-12** — KYC data exchange with the anchor; reused to bootstrap 3riKE's own verification tier.

```
Rider "Add money" ─► SEP-10 auth (JWT) ─► SEP-38 quote (GHS→USDC)
   ─► SEP-24 interactive URL (iframe) ─► rider pays via mobile money / bank
   ─► anchor delivers USDC to rider's Stellar account
   ─► SEP-24 callback webhook (X-Anchor-Signature verified) ─► mark deposit COMPLETED ─► UI updates
Withdraw is the mirror: debit USDC → anchor pays GHS to mobile money/bank.
```

---

## 6. Bridge (Stripe) — Stablecoin Orchestration & Cross-Border

3riKE integrates **Bridge's Stablecoin Orchestration API** (Stripe) for robust fiat↔USDC flows and
future **cross-border** capability (diaspora investors funding riders, regional expansion). Bridge
complements the local anchors: anchors for in-country mobile-money rails, Bridge for card/bank and
cross-border USDC. Webhooks reconcile Bridge transfers into the same unified ledger as anchor events.

---

## 7. Money-Movement Primitives (beyond Jumpa)

3riKE uses Stellar's native payment primitives directly, not just anchors:

- **Claimable Balances** — investor yield and lease refunds are issued as conditional, claimable
  on-ledger objects (auditable escrow that survives even if the recipient is briefly offline).
- **Path Payments** — a rider can pay a lease in USDC while the counterparty receives their preferred
  asset, with automatic best-path conversion across the DEX/Soroswap — no manual swap step.
- **SEP-31** — direct anchor-to-anchor **cross-border payments** for diaspora → rider funding rails.
- **SEP-7** — signed **payment-request URIs** for shareable rider-payment / investor-funding links
  (works in-chat, over SMS/WhatsApp — the "chat-native" money-request flow).

---

## 8. Oracles & Indexing

- **Reflector oracle** — 3riKE consumes Reflector's on-chain price feeds for **GHS/USD FX** (accurate
  quotes, savings valuation) and can publish/consume an **asset-performance feed** (utilisation,
  revenue) that informs investor dashboards and the credit model.
- **Soroban Events + indexer** — all contract events (`PaymentMade`, `OwnershipAdvanced`,
  `YieldDistributed`, `Delinquent`) are indexed into Postgres for fast portfolio, activity-feed, and
  ownership-progress reads — chain stays the source of truth, Postgres is the query cache.

---

## 9. DeFi Composability

- **DeFindex** — route **Target/Lock savings** into yield-bearing USDC index pools so idle balances
  beat inflation (real yield, preserving purchasing power).
- **Soroswap** — aggregator/AMM for any in-app asset conversion (feeds Path Payments; GHS-USDC legs).
- **Blend** — Soroban lending market; using `credit_registry` history, riders unlock
  **under-collateralised micro-loans** (repairs, batteries, emergencies) — extending 3riKE from
  lease-to-own into full mobility credit.

---

## 10. Unified Data Model

Chain is the source of truth; Postgres indexes it for fast reads. Core records:

```ts
// Wallet — non-custodial Stellar account (encrypted, sponsored)
interface Wallet {
  userId: string;
  publicKey: string;          // Stellar account ID (G...)
  encryptedSeed: string;      // AES-256-GCM
  iv: string; salt: string;
  smartWalletId?: string;     // Soroban passkey smart-wallet contract (optional)
  sponsored: boolean;
}

// LeaseAgreement — mirrors lease_to_own contract state
interface LeaseAgreement {
  riderId: string; vehicleId: string;
  contractId: string;         // Soroban contract / instance
  weeklyUsdc: string; priceUsdc: string;
  ownershipBps: number;       // 0..10000 (on-chain truth, indexed)
  status: "active" | "completed" | "delinquent" | "defaulted";
}

// Investment — SEP-41 share holdings + claimable yield
interface Investment {
  investorId: string; vehicleId: string;
  shares: string; shareAsset: string;   // SEP-41 asset code
  pendingYieldUsdc: string;             // sum of claimable balances
}

// SavingsGoal — Target/Lock
interface SavingsGoal {
  userId: string; goalName: string;
  targetUsdc: string; currentUsdc: string;
  kind: "target" | "lock"; unlockAt?: Date; penaltyBps?: number;
  defindexPool?: string; accumulatedYieldUsdc: string;
}

// RampTransaction — SEP-24/6 + Bridge
interface RampTransaction {
  userId: string; direction: "deposit" | "withdraw";
  provider: "anchor" | "bridge"; sep24Id?: string; bridgeId?: string;
  ghs?: string; usdc: string;
  status: "pending_user_transfer" | "pending_anchor" | "completed" | "failed";
  stellarTxHash?: string; feeBumpSponsored?: boolean;
}

// CreditRecord — indexed from credit_registry events
interface CreditRecord {
  userId: string; onTimePayments: number; latePayments: number;
  score: number;              // derived, oracle-ready
}
```

---

## 11. API Endpoints (Stellar Integration Layer)

| Module | Method | Endpoint | Description |
|---|---|---|---|
| Wallet | POST | `/stellar/wallet` | Create sponsored non-custodial Stellar account + trustlines |
| Wallet | POST | `/stellar/wallet/broadcast` | Fee-bump wrap + submit locally-signed XDR |
| Auth | POST | `/stellar/auth/sep10` | SEP-10 challenge/response → session JWT |
| Anchor | GET | `/anchor/quote` | SEP-38 GHS↔USDC quote |
| Anchor | POST | `/anchor/deposit` | SEP-24/6 interactive on-ramp (GHS→USDC) |
| Anchor | POST | `/anchor/withdraw` | SEP-24/6 off-ramp (USDC→GHS) |
| Anchor | POST | `/anchor/callback` | Signed anchor webhook (status → ledger) |
| Bridge | POST | `/bridge/transfer` | Bridge (Stripe) fiat↔USDC / cross-border |
| Lease | POST | `/lease/pay` | Weekly USDC payment → lease_to_own (split + progress) |
| Lease | GET | `/lease/status` | Ownership %, schedule, arrears |
| Invest | POST | `/invest/buy` | Buy SEP-41 shares of a vehicle |
| Invest | POST | `/invest/claim` | Claim pro-rata yield (Claimable Balance) |
| Invest | GET | `/invest/portfolio` | Holdings + pending yield (indexed) |
| Savings | POST | `/savings/create` | Open Target/Lock account |
| Savings | POST | `/savings/deposit` | Deposit USDC (+ optional DeFindex route) |
| Savings | POST | `/savings/withdraw` | Withdraw (Lock penalty enforced on-chain) |
| Credit | GET | `/credit/score` | Oracle-ready credit score + factors |

---

## 12. Security Architecture

1. **Sovereign keys** — seed encrypted with AES-256-GCM under a PBKDF2 (600k-iter) key from the user's
   PIN; only `{encryptedSeed, iv, salt}` stored; decryption is in-memory during signing only.
2. **Gas abstraction** — fee-bump envelopes; users never hold or spend XLM.
3. **Soroban authorization** — every contract invoke carries explicit auth entries scoped to the
   caller; the sponsor can only pay fees, never move user funds.
4. **Anchor/Bridge webhooks** — verify `X-Anchor-Signature` (anchor signing key) + ±5-min timestamp
   window for replay protection before mutating ledger state.
5. **Passkey option** — device-bound WebAuthn, phishing-resistant, with policy/recovery signer.
6. **Audit-readiness** — contracts written for testnet-first, with a security review milestone before
   mainnet (Tranche 3).

---

## 13. Technology Stack Summary

| Layer | Technology | Status |
|---|---|---|
| Frontend PWA | React 19 · Vite · Tailwind v4 | ✅ Live UI at 3rike.xyz |
| Backend API | Node.js · TypeScript · Express | ✅ Existing (product logic shipped) |
| Data | PostgreSQL · Prisma (ledger index + app state) | ✅ Existing |
| Key security | AES-256-GCM + PBKDF2 (node `crypto`) | ✅ Existing (same model, ported) |
| Stellar SDK | `@stellar/stellar-sdk` (Horizon + Soroban RPC) | 🆕 Integrate |
| Smart contracts | **Soroban / Rust** — vault, lease, yield, savings, credit | 🆕 Build (core focus) |
| Token standard | **SEP-41** fractional shares · USDC **SAC** | 🆕 Integrate |
| Onboarding | **Sponsored Reserves + Fee-Bump** gas abstraction | 🆕 Integrate |
| Wallet (option) | **Passkey smart wallet** (Soroban / WebAuthn) | 🆕 Integrate |
| Ramps | Anchors **SEP-6 / SEP-24 / SEP-10 / SEP-38 / SEP-12** | 🆕 Integrate |
| Fiat/cross-border | **Bridge (Stripe)** Stablecoin Orchestration · **SEP-31** | 🆕 Integrate |
| Payments | **Claimable Balances · Path Payments · SEP-7** links | 🆕 Integrate |
| Oracles/Index | **Reflector** feeds · Soroban events indexer | 🆕 Integrate |
| DeFi | **DeFindex** (savings) · **Soroswap** (swaps) · **Blend** (credit) | 🆕 Integrate |

---

## 14. How the Architecture Delivers the SCF Tranches

- **Tranche 1 (Foundations & Testnet MVP):** §3 non-custodial sponsored wallets + fee-bump gas
  abstraction; §5 anchor ramps (SEP-10/6/24/38); §4.1/§4.4 initial `tricycle_vault` + `savings`
  contracts on testnet.
- **Tranche 2 (Advanced Logic & Full Integration):** §4.2/§4.3 full `lease_to_own` + `yield_distributor`
  with milestone/default handling; §4.5 `credit_registry`; §8 event indexer; end-to-end rider+investor
  journeys wired from 3rike.xyz.
- **Tranche 3 (Mainnet & Pilot):** mainnet deploy + security review; §6 Bridge + §7 SEP-31 cross-border;
  §9 DeFindex/Blend composability; pilot with the Pragyia Riders' Union; docs + reusable integration
  patterns for the Stellar ecosystem.

---

*3riKE brings transparency, ownership, and programmable finance to Africa's informal mobility economy —
built natively on Stellar, composable by design, and ready to onboard thousands of first-time Stellar
users through tools that solve a real, high-demand problem.*
