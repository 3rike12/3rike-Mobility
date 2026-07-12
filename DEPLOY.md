# 3rike — Deployment (Railway backend + Vercel frontend)

Both deploy straight from the GitHub repo (`3rike12/3rike-Mobility`). Do the
backend first (you need its URL for the frontend).

---

## 1. Backend → Railway

1. **New Project → Deploy from GitHub repo** → pick `3rike12/3rike-Mobility`.
2. In the service **Settings**:
   - **Root Directory:** `backend`
   - Build/Start are auto-detected from `package.json`:
     - Build: `prisma generate && tsc`
     - Start: `prisma db push --skip-generate && node dist/index.js`  ← applies the schema to Postgres on each deploy
3. **Add Postgres:** in the project, **+ New → Database → PostgreSQL**.
4. **Variables** (service → Variables) — set these:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres plugin) |
   | `JWT_SECRET` | `openssl rand -hex 32` |
   | `ENCRYPTION_KEY` | `openssl rand -hex 32` (64 hex chars) |
   | `ARC_RPC_URL` | `https://rpc.testnet.arc.network` |
   | `CHAIN_ID` | `5042002` |
   | `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` (Circle USDC on Arc) |
   | `TRICYCLE_NFT_ADDRESS` | _(from your Arc deploy — see contracts/deployments.md)_ |
   | `INVESTMENT_ADDRESS` | _(from your Arc deploy)_ |
   | `VAULT_ADDRESS` | _(from your Arc deploy, optional)_ |
   | `RELAYER_PRIVATE_KEY` | (the relayer key — keep this wallet funded with testnet USDC from faucet.circle.com; USDC = gas on Arc) |
   | `CORS_ORIGIN` | your Vercel URL (set after step 2; can start with `*` to unblock, then lock down) |
   | `PORT` | `8080` (Railway also injects its own; the app reads `PORT`) |
   | *(optional, bank rails)* | `ARBITRUM_RPC_URL`, `ARBITRUM_USDC`, `TREASURY_ADDRESS`, `TREASURY_PRIVATE_KEY`, `PAYCREST_BASE`, `PAYCREST_API_KEY`, `PAYCREST_API_SECRET` |
5. **Generate a domain:** Settings → Networking → **Generate Domain**. Copy it
   (e.g. `https://3rike-backend.up.railway.app`).
6. Verify: open `https://<backend>/health` → `{"ok":true,"chainId":5042002}`.

> ⚠️ Secrets: never commit `.env`. `RELAYER_PRIVATE_KEY` (and `TREASURY_PRIVATE_KEY`)
> are real keys — set them only in Railway Variables. **Rotate the Paycrest secret**
> (it was shared in chat) before using bank rails in production.

---

## 2. Frontend → Vercel

1. **Add New → Project** → import `3rike12/3rike-Mobility`.
2. **Root Directory:** `3rike-frontend`.
3. Framework preset: **Vite** (auto). Build `npm run build`, output `dist`.
   (SPA deep-link routing is handled by `3rike-frontend/vercel.json`.)
4. **Environment Variable:**
   | Key | Value |
   |---|---|
   | `VITE_API_URL` | your Railway backend URL (no trailing slash) |
5. **Deploy.** Copy the resulting URL (e.g. `https://3rike.vercel.app`).

---

## 3. Wire them together
1. Back in **Railway → Variables**, set `CORS_ORIGIN` to the exact Vercel URL
   (comma-separate multiple domains). Redeploy the backend.
2. (Optional, bank rails) Set the Paycrest **webhook URL** to
   `https://<backend>/payments/webhook`.
3. Open the Vercel URL → sign up → confirm balance loads (hits the backend).

---

## Notes
- **Schema sync:** `prisma db push` runs on every backend deploy — safe/idempotent.
  No migration files needed.
- **Local dev now needs Postgres** (provider switched from SQLite). Point local
  `DATABASE_URL` at the Railway Postgres (Connect → Public URL) or a free Neon DB,
  then `npx prisma db push`.
- **Relayer gas:** the hosted app still needs the relayer wallet funded with testnet
  ETH — it sponsors all on-chain actions. Keep `0xCc73…47D3` topped up.
