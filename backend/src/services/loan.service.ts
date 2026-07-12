// Loan domain service. Gated by KYC + credit score. Principal is disbursed as
// USDC to the rider's wallet; repayment (principal + flat interest) is debited
// back from the wallet and feeds the credit score.

import bcrypt from "bcryptjs";
import { parseUnits } from "viem";
import { prisma } from "../db.js";
import {
  fundUsdc,
  withdrawUsdc,
  usdcBalanceRaw,
  relayer,
  explorerTx,
} from "../lib/chain.js";
import { creditScoreFor } from "./credit.service.js";

const TERM_WEEKS = 10;
const INTEREST_PCT = 10;
const THRESHOLD = 600;

export class LoanError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

export interface Eligibility {
  kycStatus: string;
  creditScore: number | null;
  band: string;
  maxLoanUsdc: number;
  termWeeks: number;
  interestPct: number;
  eligible: boolean;
  reason: string; // "" | not_verified | low_score | active_loan
  activeLoanId: number | null;
}

export async function eligibility(userId: number): Promise<Eligibility> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new LoanError("not_found", 404);

  const credit = await creditScoreFor(userId);
  const active = await prisma.loan.findFirst({ where: { userId, status: "active" } });

  let eligible = true;
  let reason = "";
  if (user.kycStatus !== "verified") {
    eligible = false;
    reason = "not_verified";
  } else if ((credit.score ?? 0) < THRESHOLD) {
    eligible = false;
    reason = "low_score";
  } else if (active) {
    eligible = false;
    reason = "active_loan";
  }

  return {
    kycStatus: user.kycStatus,
    creditScore: credit.score,
    band: credit.band,
    maxLoanUsdc: credit.maxLoanUsdc,
    termWeeks: TERM_WEEKS,
    interestPct: INTEREST_PCT,
    eligible,
    reason,
    activeLoanId: active?.id ?? null,
  };
}

export async function apply(userId: number, amountUsdc: string) {
  const elig = await eligibility(userId);
  if (!elig.eligible) throw new LoanError(elig.reason || "not_eligible", 403);

  const amt = Number(amountUsdc);
  if (!(amt > 0)) throw new LoanError("invalid_amount");
  if (amt > elig.maxLoanUsdc) throw new LoanError("exceeds_limit");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new LoanError("not_found", 404);

  // Disburse principal to the rider's wallet.
  const tx = await fundUsdc(user.walletAddress as `0x${string}`, amt.toFixed(6));

  const totalDue = amt * (1 + INTEREST_PCT / 100);
  const weekly = totalDue / TERM_WEEKS;
  const loan = await prisma.loan.create({
    data: {
      userId,
      principalUsdc: amt.toFixed(6),
      totalDueUsdc: totalDue.toFixed(6),
      outstandingUsdc: totalDue.toFixed(6),
      weeklyRepayment: weekly.toFixed(6),
      termWeeks: TERM_WEEKS,
      interestPct: INTEREST_PCT,
      status: "active",
      disburseTxHash: tx,
    },
  });

  return { loan, txHash: tx, explorer: explorerTx(tx) };
}

export async function repay(userId: number, loanId: number, amountUsdc: string, pin: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new LoanError("not_found", 404);

  // PIN gate (verify if set, else enroll on first use).
  if (user.pinHash) {
    if (!(await bcrypt.compare(pin, user.pinHash))) throw new LoanError("wrong_pin", 403);
  } else {
    await prisma.user.update({ where: { id: userId }, data: { pinHash: await bcrypt.hash(pin, 10) } });
  }

  const loan = await prisma.loan.findFirst({ where: { id: loanId, userId } });
  if (!loan || loan.status !== "active") throw new LoanError("loan_not_found", 404);

  let amt = Number(amountUsdc);
  if (!(amt > 0)) throw new LoanError("invalid_amount");
  const outstanding = Number(loan.outstandingUsdc);
  if (amt > outstanding) amt = outstanding; // never overpay the loan
  const amtStr = amt.toFixed(6);

  const bal = await usdcBalanceRaw(user.walletAddress as `0x${string}`);
  if (bal < parseUnits(amtStr, 6)) throw new LoanError("insufficient_funds");

  // Debit the repayment from the rider's wallet back to the platform.
  const tx = await withdrawUsdc(user.encryptedKey, relayer.address, amtStr);

  const newOutstanding = Math.max(0, outstanding - amt);
  const repaid = newOutstanding <= 0.000001;
  await prisma.loan.update({
    where: { id: loan.id },
    data: {
      outstandingUsdc: newOutstanding.toFixed(6),
      status: repaid ? "repaid" : "active",
      repaidAt: repaid ? new Date() : null,
    },
  });
  await prisma.loanRepayment.create({ data: { loanId: loan.id, amountUsdc: amtStr, txHash: tx } });

  return {
    txHash: tx,
    explorer: explorerTx(tx),
    outstandingUsdc: newOutstanding.toFixed(6),
    repaid,
  };
}

export async function listLoans(userId: number) {
  return prisma.loan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { repayments: { orderBy: { createdAt: "desc" } } },
  });
}
