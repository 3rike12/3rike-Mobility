import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import {
  usdcBalance,
  usdcBalanceRaw,
  vaultPositionUsdc,
  fundUsdc,
  withdrawUsdc,
  explorerTx,
  explorerAddress,
} from "../lib/chain.js";
import { parseUnits } from "viem";

const router = Router();

async function loadWallet(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return user.walletAddress as `0x${string}`;
}

// Live balances: spendable USDC in the wallet + value held in the yield vault.
router.get("/balance", requireAuth, async (req: AuthedRequest, res) => {
  const address = await loadWallet(req.userId!);
  if (!address) return res.status(404).json({ error: "not_found" });

  const [wallet, vault] = await Promise.all([
    usdcBalance(address),
    vaultPositionUsdc(address),
  ]);

  res.json({
    address,
    explorer: explorerAddress(address),
    walletUsdc: wallet,
    vaultUsdc: vault,
    totalUsdc: (Number(wallet) + Number(vault)).toFixed(6),
  });
});

// Demo/crypto-deposit helper: credit USDC to the user's wallet by transferring
// real Circle USDC from the platform relayer (Arc USDC has no open mint). In
// production this is replaced by real on-ramp / inbound-transfer detection.
const fundSchema = z.object({ amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/) });

router.post("/dev-fund", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = fundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });

  const address = await loadWallet(req.userId!);
  if (!address) return res.status(404).json({ error: "not_found" });

  try {
    const hash = await fundUsdc(address, parsed.data.amountUsdc);
    await prisma.deposit.create({
      data: {
        userId: req.userId!,
        kind: "crypto",
        amountUsdc: parsed.data.amountUsdc,
        txHash: hash,
        status: "confirmed",
      },
    });
    res.json({ txHash: hash, explorer: explorerTx(hash) });
  } catch (err) {
    console.error("dev-fund failed", err);
    res.status(502).json({ error: "chain_error" });
  }
});

// Withdraw USDC from the user's embedded wallet to an external address.
const withdrawSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  pin: z.string().regex(/^\d{4}$/),
});

router.post("/withdraw-crypto", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  const { to, amountUsdc, pin } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "not_found" });

  // PIN gate: verify if one is set, otherwise enroll this PIN on first use.
  if (user.pinHash) {
    if (!(await bcrypt.compare(pin, user.pinHash))) {
      return res.status(403).json({ error: "wrong_pin" });
    }
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash: await bcrypt.hash(pin, 10) },
    });
  }

  // Only spendable (wallet) USDC can be withdrawn directly.
  const balance = await usdcBalanceRaw(user.walletAddress as `0x${string}`);
  const amount = parseUnits(amountUsdc, 6);
  if (amount <= 0n) return res.status(400).json({ error: "invalid_amount" });
  if (balance < amount) return res.status(400).json({ error: "insufficient_funds" });

  try {
    const hash = await withdrawUsdc(user.encryptedKey, to as `0x${string}`, amountUsdc);
    await prisma.deposit.create({
      data: {
        userId: req.userId!,
        kind: "withdraw-crypto",
        amountUsdc,
        txHash: hash,
        status: "confirmed",
      },
    });
    res.json({ txHash: hash, explorer: explorerTx(hash) });
  } catch (err) {
    console.error("withdraw-crypto failed", err);
    res.status(502).json({ error: "chain_error" });
  }
});

export default router;
