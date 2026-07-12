import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { parseUnits } from "viem";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { usdcBalanceRaw, fundUsdc, withdrawUsdc, relayer } from "../lib/chain.js";
import {
  paycrestRate,
  paycrestInstitutions,
  paycrestVerifyAccount,
  paycrestCreateOfframp,
  paycrestBuyRate,
  paycrestCreateOnramp,
  paycrestGetOrderV2,
  verifyPaycrestWebhook,
} from "../lib/paycrest.js";
import {
  treasuryConfigured,
  treasuryUsdcBalance,
  treasurySendUsdc,
} from "../lib/arbitrum.js";

const router = Router();

// Live USD->NGN rate (NGN per 1 USDC). No minimum — used for display toggles
// (e.g. showing a balance in Naira). Public; cached client-side.
router.get("/rate", async (_req, res) => {
  const rate = await paycrestRate("usdc", "1", "ngn");
  res.json({ rate, ngnPerUsdc: rate ? Number(rate) : null });
});

// List NGN banks (institution codes for the withdrawal form).
router.get("/banks", requireAuth, async (_req, res) => {
  const banks = await paycrestInstitutions("NGN");
  res.json({ banks });
});

// Resolve a bank account name before withdrawing.
router.post("/resolve-account", requireAuth, async (req, res) => {
  const p = z
    .object({ institution: z.string(), accountIdentifier: z.string() })
    .safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid_input" });
  const accountName = await paycrestVerifyAccount(p.data.institution, p.data.accountIdentifier);
  res.json({ accountName });
});

// Quote: how much NGN the user receives for X USDC.
router.get("/withdraw/quote", requireAuth, async (req, res) => {
  const amount = String(req.query.amountUsdc ?? "1");
  const rate = await paycrestRate("usdc", amount, "ngn");
  res.json({ rate, ngn: rate ? (Number(rate) * Number(amount)).toFixed(2) : null });
});

// Off-ramp: withdraw to a Nigerian bank account.
// Flow: PIN-gate -> create Paycrest order -> debit user's testnet USDC ->
// send real USDC from the Arbitrum treasury to Paycrest -> webhook settles it.
const wdSchema = z.object({
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/),
  institution: z.string().min(3),
  accountIdentifier: z.string().min(5),
  accountName: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/),
});

router.post("/withdraw/bank", requireAuth, async (req: AuthedRequest, res) => {
  const p = wdSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid_input" });
  const { amountUsdc, institution, accountIdentifier, accountName, pin } = p.data;

  if (Number(amountUsdc) < 0.5) return res.status(400).json({ error: "below_minimum" });
  if (!treasuryConfigured()) return res.status(503).json({ error: "treasury_not_configured" });

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "not_found" });

  // PIN gate (verify if set, else enroll).
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

  // User must hold the testnet balance they're withdrawing.
  const userBal = await usdcBalanceRaw(user.walletAddress as `0x${string}`);
  if (userBal < parseUnits(amountUsdc, 6)) {
    return res.status(400).json({ error: "insufficient_funds" });
  }

  // Live rate + create the off-ramp order (returns receiveAddress + fees).
  const rate = await paycrestRate("usdc", amountUsdc, "ngn");
  if (!rate) return res.status(502).json({ error: "rate_unavailable" });

  let order;
  try {
    order = await paycrestCreateOfframp({
      amount: amountUsdc,
      token: "USDC",
      rate,
      network: "arbitrum-one",
      recipient: {
        institution,
        accountIdentifier,
        accountName,
        memo: "3rike withdrawal",
        currency: "NGN",
      },
      reference: `3rike-wd-${user.id}-${Date.now()}`,
      returnAddress: config.treasuryAddress,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/minimum|too small|less than|min /i.test(msg)) return res.status(400).json({ error: "below_minimum" });
    if (/account/i.test(msg)) return res.status(400).json({ error: "invalid_account" });
    console.error("paycrest order failed:", msg);
    return res.status(502).json({ error: "order_failed", detail: msg.slice(0, 120) });
  }

  // Treasury must cover amount + fees before we debit the user.
  const total = (
    Number(amountUsdc) +
    Number(order.senderFee || 0) +
    Number(order.transactionFee || 0)
  ).toFixed(6);
  if (Number(await treasuryUsdcBalance()) < Number(total)) {
    return res.status(503).json({ error: "treasury_insufficient" });
  }

  // Debit the user's testnet balance (move it to the relayer).
  await withdrawUsdc(user.encryptedKey, relayer.address, amountUsdc);

  // Fund the order: real USDC from treasury -> Paycrest receiveAddress.
  let txHash: string;
  try {
    txHash = await treasurySendUsdc(order.receiveAddress, total);
  } catch (err) {
    // Compensate: re-credit the user's testnet balance.
    await fundUsdc(user.walletAddress as `0x${string}`, amountUsdc).catch(() => {});
    console.error("treasury send failed:", (err as Error).message);
    return res.status(502).json({ error: "treasury_send_failed" });
  }

  const ngn = (Number(order.rate ?? rate) * Number(amountUsdc)).toFixed(2);
  await prisma.paymentOrder.create({
    data: {
      userId: user.id,
      direction: "offramp",
      paycrestId: String(order.id),
      amountUsdc,
      amountNgn: ngn,
      status: "pending",
      txHash,
      reference: order.reference,
    },
  });

  res.json({ orderId: order.id, status: "pending", ngn });
});

// On-ramp deposit quote: how much USDC for X NGN.
router.get("/deposit/quote", requireAuth, async (req, res) => {
  const amountNgn = String(req.query.amountNgn ?? "1000");
  const rate = await paycrestBuyRate("1");
  const usdc = rate ? (Number(amountNgn) / Number(rate)).toFixed(6) : null;
  res.json({ rate, usdc });
});

// On-ramp deposit: create order -> return the virtual account the user pays NGN to.
const depSchema = z.object({
  amountNgn: z.string().regex(/^\d+(\.\d{1,2})?$/),
  institution: z.string().min(3),
  accountIdentifier: z.string().min(5),
  accountName: z.string().min(1),
});

router.post("/deposit/bank", requireAuth, async (req: AuthedRequest, res) => {
  const p = depSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid_input" });
  if (!config.treasuryAddress) return res.status(503).json({ error: "treasury_not_configured" });

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "not_found" });

  let order;
  try {
    order = await paycrestCreateOnramp({
      amountNgn: p.data.amountNgn,
      refundAccount: {
        institution: p.data.institution,
        accountIdentifier: p.data.accountIdentifier,
        accountName: p.data.accountName,
      },
      recipientAddress: config.treasuryAddress,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/minimum|too small|less than|min /i.test(msg)) return res.status(400).json({ error: "below_minimum" });
    if (/account/i.test(msg)) return res.status(400).json({ error: "invalid_account" });
    console.error("onramp order failed:", msg);
    return res.status(502).json({ error: "order_failed", detail: msg.slice(0, 120) });
  }

  await prisma.paymentOrder.create({
    data: {
      userId: user.id,
      direction: "onramp",
      paycrestId: String(order.id),
      amountUsdc: order.amount,
      amountNgn: p.data.amountNgn,
      status: "pending",
    },
  });

  res.json({
    orderId: order.id,
    amountUsdc: order.amount,
    rate: order.rate,
    providerAccount: order.providerAccount,
  });
});

// Poll the on-ramp order; once Paycrest settles, credit the user's testnet USDC.
router.post("/deposit/check", requireAuth, async (req: AuthedRequest, res) => {
  const p = z.object({ orderId: z.string() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "invalid_input" });

  const order = await prisma.paymentOrder.findUnique({ where: { paycrestId: p.data.orderId } });
  if (!order || order.userId !== req.userId) return res.status(404).json({ error: "not_found" });
  if (order.status === "settled") {
    return res.json({ status: "settled", creditedUsdc: order.amountUsdc, alreadyCredited: true });
  }

  const pc = await paycrestGetOrderV2(p.data.orderId);
  const st = pc?.status;
  if (st === "settled" || st === "fulfilled" || st === "validated") {
    const user = await prisma.user.findUnique({ where: { id: order.userId } });
    if (user) await fundUsdc(user.walletAddress as `0x${string}`, order.amountUsdc).catch(() => {});
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "settled" } });
    return res.json({ status: "settled", creditedUsdc: order.amountUsdc });
  }
  res.json({ status: st ?? "pending" });
});

// Paycrest webhook — verifies HMAC, updates order, re-credits on failed off-ramp.
router.post("/webhook", async (req: any, res) => {
  const sig = req.headers["x-paycrest-signature"] as string | undefined;
  if (!verifyPaycrestWebhook(req.rawBody, sig)) {
    return res.status(401).json({ error: "bad_signature" });
  }

  const event = (req.body?.event as string) || "";
  const data = req.body?.data ?? {};
  const order = await prisma.paymentOrder.findUnique({
    where: { paycrestId: String(data.id ?? "") },
  });
  if (!order) return res.json({ ok: true });

  const status = event.split(".")[1] || data.status;

  if (status === "settled" || status === "validated") {
    if (order.status !== "settled") {
      // On-ramp completed → credit the user's testnet USDC.
      if (order.direction === "onramp") {
        const user = await prisma.user.findUnique({ where: { id: order.userId } });
        if (user) await fundUsdc(user.walletAddress as `0x${string}`, order.amountUsdc).catch(() => {});
      }
      await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "settled" } });
    }
  } else if (status === "refunded" || status === "expired") {
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { status } });
    // Off-ramp failed after we debited the user → re-credit their testnet balance.
    if (order.direction === "offramp") {
      const user = await prisma.user.findUnique({ where: { id: order.userId } });
      if (user) {
        await fundUsdc(user.walletAddress as `0x${string}`, order.amountUsdc).catch(() => {});
      }
    }
  }
  res.json({ ok: true });
});

export default router;
