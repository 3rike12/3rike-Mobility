// API client for the 3rike backend.
//
// Responsibilities:
//   - Read base URL from VITE_API_URL.
//   - Inject the JWT from session storage on every request.
//   - Normalize errors into a typed ApiError that carries HTTP status + the
//     backend "error" code so callers can show specific messages.
//   - Be tolerant of Render free-tier cold starts (first hit can take ~60s).
//   - On 401, clear the local session and emit a global event so AuthProvider
//     can react without coupling api.ts to React.

import { clearSession, getToken } from "./session";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

// Cold starts on Render free tier can take ~60s.
const DEFAULT_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

// Fired when the API returns 401, so AuthProvider can navigate to /login.
// Using a window event keeps this module decoupled from React/router.
export const UNAUTHORIZED_EVENT = "3rike:unauthorized";

type RequestOptions = RequestInit & {
  /** Skip JWT injection (used by /auth/login + /auth/register). */
  skipAuth?: boolean;
  /** Override the default timeout. */
  timeoutMs?: number;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { skipAuth, timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = opts;

  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string> | undefined),
  };

  if (!skipAuth) {
    const token = getToken();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: finalHeaders,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ApiError(0, "timeout", "Request timed out. Please try again.");
    }
    throw new ApiError(0, "network_error", "Network error. Please check your connection.");
  } finally {
    window.clearTimeout(timeout);
  }

  const text = await res.text();
  const data = text ? safeParse(text) : {};

  if (!res.ok) {
    const rawCode = (data as Record<string, unknown>)?.error;
    const code = typeof rawCode === "string" ? rawCode : "request_failed";

    // Only treat a 401 as "session expired" when it's the auth middleware
    // rejecting the token — NOT domain 401s like wrong_pin / wrong_password,
    // which would otherwise log the user out mid-action.
    if (res.status === 401 && !skipAuth && code === "unauthorized") {
      clearSession();
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }

    throw new ApiError(res.status, code);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// =============================================================================
// Auth
// =============================================================================

export type Role = "driver" | "investor" | "admin";

export type User = {
  id: number;
  email: string;
  role: Role;
  fullName?: string;
  phone?: string;
  country?: string;
  address?: string;
  /** Whether a payment PIN has been set. */
  hasPin?: boolean;
  /** KYC/verification status — server-side, follows the account. none | verified. */
  kycStatus?: "none" | "verified";
  /** Embedded EVM wallet auto-created on signup. */
  walletAddress?: string;
  /** Legacy Canton field — retained optional for back-compat with old screens. */
  canton_party_id?: string;
  created_at?: string;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export function register(payload: {
  email: string;
  password: string;
  role: Role;
  fullName?: string;
  phone?: string;
  pin?: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}

export function login(payload: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}

// =============================================================================
// EVM wallet (Arc) — live balances + crypto deposit
// =============================================================================

export type EvmBalance = {
  address: string;
  explorer: string;
  /** Spendable USDC sitting in the wallet (decimal string, 6dp). */
  walletUsdc: string;
  /** USDC value held in the yield vault. */
  vaultUsdc: string;
  /** wallet + vault. */
  totalUsdc: string;
};

export function getEvmBalance(): Promise<EvmBalance> {
  return request<EvmBalance>("/wallet/balance");
}

/** Credit USDC to the user's wallet on-chain (crypto deposit). */
export function cryptoDeposit(
  amountUsdc: string,
): Promise<{ txHash: string; explorer: string }> {
  return request("/wallet/dev-fund", {
    method: "POST",
    body: JSON.stringify({ amountUsdc }),
  });
}

/** Withdraw USDC from the user's wallet to an external address (crypto-out). */
export function withdrawCrypto(payload: {
  to: string;
  amountUsdc: string;
  pin: string;
}): Promise<{ txHash: string; explorer: string }> {
  return request("/wallet/withdraw-crypto", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// =============================================================================
// Bank withdrawal (Paycrest off-ramp: testnet USDC -> real ₦ via treasury)
// =============================================================================

export type Bank = { name: string; code: string };

export function getBanks(): Promise<{ banks: Bank[] }> {
  return request<{ banks: Bank[] }>("/payments/banks");
}

export function resolveBankAccount(
  institution: string,
  accountIdentifier: string,
): Promise<{ accountName: string | null }> {
  return request("/payments/resolve-account", {
    method: "POST",
    body: JSON.stringify({ institution, accountIdentifier }),
  });
}

export function bankWithdrawQuote(
  amountUsdc: string,
): Promise<{ rate: string | null; ngn: string | null }> {
  return request(`/payments/withdraw/quote?amountUsdc=${encodeURIComponent(amountUsdc)}`);
}

// Live USD->NGN rate (NGN per 1 USDC) for display toggles. No minimum.
export function usdToNgnRate(): Promise<{ rate: string | null; ngnPerUsdc: number | null }> {
  return request("/payments/rate");
}

export function withdrawToBank(payload: {
  amountUsdc: string;
  institution: string;
  accountIdentifier: string;
  accountName: string;
  pin: string;
}): Promise<{ orderId: string; status: string; ngn: string }> {
  return request("/payments/withdraw/bank", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Bank deposit (Paycrest on-ramp: real ₦ -> USDC to treasury -> testnet USDC)
export type ProviderAccount = {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  amountToTransfer: string;
  currency: string;
  validUntil: string;
};

export function bankDepositQuote(
  amountNgn: string,
): Promise<{ rate: string | null; usdc: string | null }> {
  return request(`/payments/deposit/quote?amountNgn=${encodeURIComponent(amountNgn)}`);
}

export function createBankDeposit(payload: {
  amountNgn: string;
  institution: string;
  accountIdentifier: string;
  accountName: string;
}): Promise<{ orderId: string; amountUsdc: string; rate: string; providerAccount: ProviderAccount }> {
  return request("/payments/deposit/bank", { method: "POST", body: JSON.stringify(payload) });
}

export function checkBankDeposit(
  orderId: string,
): Promise<{ status: string; creditedUsdc?: string }> {
  return request("/payments/deposit/check", { method: "POST", body: JSON.stringify({ orderId }) });
}

export function me(): Promise<User> {
  return request<User>("/auth/me");
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function updateProfile(payload: {
  email?: string;
  fullName?: string;
  phone?: string;
  country?: string;
  address?: string;
}): Promise<User> {
  return request<User>("/auth/profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function changePassword(payload: {
  old_password: string;
  new_password: string;
}): Promise<{ message: string }> {
  return request<{ message: string }>("/auth/password", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** Set or change the 4-digit payment PIN. old_pin is required only if one exists. */
export function changePin(payload: {
  old_pin?: string;
  new_pin: string;
}): Promise<{ message: string }> {
  return request<{ message: string }>("/auth/pin", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** Verify the current PIN (throws ApiError with code "wrong_pin" if incorrect). */
export function verifyPin(pin: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/auth/verify-pin", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
}

export function deleteAccount(): Promise<void> {
  return request<void>("/auth/account", { method: "DELETE" });
}

export type Session = {
  id: string;
  user_id: number;
  role: Role;
  created_at: string;
  expires_at: string;
};

export function listSessions(): Promise<Session[]> {
  return request<Session[]>("/auth/sessions");
}

export function revokeSession(sessionId: string): Promise<void> {
  return request<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

// =============================================================================
// Canton Wallet
// =============================================================================

/**
 * Live wallet balance fetched from the Canton ledger. All quantity fields are
 * decimal strings (Canton uses arbitrary-precision decimals, so we don't lose
 * precision by parsing them as numbers — keep them as strings and format on
 * display).
 */
export type WalletBalance = {
  round: number;
  effective_unlocked_qty: string;
  effective_locked_qty: string;
  total_holding_fees: string;
};

export function linkWallet(payload: {
  canton_party_id: string;
}): Promise<User> {
  return request<User>("/auth/wallet", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getWalletBalance(): Promise<WalletBalance> {
  return request<WalletBalance>("/auth/wallet/balance");
}

// =============================================================================
// Drivers
// =============================================================================

export type Driver = {
  id: number;
  user_id: number;
  full_name: string;
  phone: string;
  country: string;
  credit_score: number;
  weeks_remaining: number;
  created_at: string;
};

export function createDriver(payload: {
  full_name: string;
  phone: string;
  country: string;
}): Promise<Driver> {
  return request<Driver>("/api/drivers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDriver(id: number): Promise<Driver> {
  return request<Driver>(`/api/drivers/${id}`);
}

export function listDrivers(): Promise<Driver[]> {
  return request<Driver[]>("/api/drivers");
}

// =============================================================================
// Investors
// =============================================================================

export type Investor = {
  id: number;
  user_id: number;
  full_name: string;
  wallet_address: string;
  created_at: string;
};

export function createInvestor(payload: {
  full_name: string;
  wallet_address: string;
}): Promise<Investor> {
  return request<Investor>("/api/investors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getInvestor(id: number): Promise<Investor> {
  return request<Investor>(`/api/investors/${id}`);
}

// =============================================================================
// Investment — fractional ownership (real on-chain USDC + ERC-1155 shares)
// =============================================================================

export type Tricycle = {
  id: number;
  vehicleId: string;
  make: string;
  model: string;
  isEV: boolean;
  priceUsd: number;
  rangeKm: number;
  image: string;
  location: string;
  description: string;
  projectedApr: number;
  weeklyRepayment: number; // USD the rider pays per week
  pricePerShare: string; // USDC, decimal string
  totalShares: number;
  sharesSold: number;
  sharesAvailable: number;
  fundedPct: number; // 0..100
  active: boolean;
};

export async function listTricycles(): Promise<Tricycle[]> {
  const { tricycles } = await request<{ tricycles: Tricycle[] }>("/investment/tricycles");
  return tricycles;
}

export function getTricycle(id: number): Promise<Tricycle> {
  return request<Tricycle>(`/investment/tricycles/${id}`);
}

export type InvestResult = {
  txHash: string;
  explorer: string;
  costUsdc: string;
  shares: number;
};

/**
 * Buy `shares` fractions of a tricycle. Moves real USDC from the user's
 * embedded wallet on-chain (gas sponsored by the platform) and mints
 * ERC-1155 shares to them.
 */
export function invest(payload: {
  tricycleId: number;
  shares: number;
}): Promise<InvestResult> {
  return request<InvestResult>("/investment/invest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type Holding = {
  id: number;
  vehicleId: string;
  make: string;
  model: string;
  image: string;
  shares: number;
  ownershipPct: number;
  valueUsdc: string;
  pendingYield: string;
  projectedApr: number; // indicative annual yield %
};

export type Portfolio = {
  holdings: Holding[];
  totals: {
    investedValueUsdc: string;
    pendingYieldUsdc: string;
    tricycles: number;
  };
};

export function getPortfolio(): Promise<Portfolio> {
  return request<Portfolio>("/investment/portfolio");
}

export type ClaimResult = {
  txHash: string;
  explorer: string;
  amountUsdc: string;
};

export function claimYield(tricycleId: number): Promise<ClaimResult> {
  return request<ClaimResult>("/investment/claim-yield", {
    method: "POST",
    body: JSON.stringify({ tricycleId }),
  });
}

export type InvestmentActivity = {
  id: number;
  tricycleId: number;
  vehicleId: string;
  action: "invest" | "claim";
  shares: string | null;
  amountUsdc: string;
  txHash: string;
  createdAt: string;
};

export async function listInvestmentActivity(): Promise<InvestmentActivity[]> {
  const { activity } = await request<{ activity: InvestmentActivity[] }>("/investment/activity");
  return activity;
}

// =============================================================================
// KYC / verification + credit score
// =============================================================================

export type CreditFactor = { label: string; points: number };
export type Credit = {
  score: number | null; // null = locked (not verified)
  band: string;
  factors: CreditFactor[];
  maxLoanUsdc: number;
};

export type KycStatus = {
  kycStatus: "none" | "verified";
  fullName: string | null;
  verifiedAt: string | null;
  credit: Credit;
};

export function getKycStatus(): Promise<KycStatus> {
  return request<KycStatus>("/kyc/status");
}

export function submitKyc(payload: {
  fullName: string;
  idNumber: string;
  phone?: string;
}): Promise<{ kycStatus: "verified"; credit: Credit }> {
  return request("/kyc/submit", { method: "POST", body: JSON.stringify(payload) });
}

// =============================================================================
// Loans (gated by verification + credit score)
// =============================================================================

export type LoanEligibility = {
  kycStatus: "none" | "verified";
  creditScore: number | null;
  band: string;
  maxLoanUsdc: number;
  termWeeks: number;
  interestPct: number;
  eligible: boolean;
  reason: "" | "not_verified" | "low_score" | "active_loan";
  activeLoanId: number | null;
};

export type LoanRepayment = {
  id: number;
  amountUsdc: string;
  txHash: string | null;
  createdAt: string;
};

export type Loan = {
  id: number;
  principalUsdc: string;
  totalDueUsdc: string;
  outstandingUsdc: string;
  weeklyRepayment: string;
  termWeeks: number;
  interestPct: number;
  status: "active" | "repaid";
  disburseTxHash: string | null;
  createdAt: string;
  repaidAt: string | null;
  repayments: LoanRepayment[];
};

export function loanEligibility(): Promise<LoanEligibility> {
  return request<LoanEligibility>("/loans/eligibility");
}

export async function listLoans(): Promise<Loan[]> {
  const { loans } = await request<{ loans: Loan[] }>("/loans");
  return loans;
}

export function applyForLoan(amountUsdc: string): Promise<{
  loan: Loan;
  txHash: string;
  explorer: string;
}> {
  return request("/loans/apply", { method: "POST", body: JSON.stringify({ amountUsdc }) });
}

export function repayLoan(
  loanId: number,
  payload: { amountUsdc: string; pin: string },
): Promise<{ txHash: string; explorer: string; outstandingUsdc: string; repaid: boolean }> {
  return request(`/loans/${loanId}/repay`, { method: "POST", body: JSON.stringify(payload) });
}

// =============================================================================
// Rider weekly payments (toward owning a tricycle → yields to its investors)
// =============================================================================

export type RiderPaymentRow = {
  id: number;
  tricycleId: number;
  amountUsdc: string;
  yieldUsdc: string;
  txHash: string | null;
  yieldTxHash: string | null;
  createdAt: string;
};

export type RiderTricycle = {
  id: number;
  vehicleId: string;
  make: string;
  model: string;
  isEV: boolean;
  priceUsd: number;
  image: string;
  location: string;
};

export type RiderStatus =
  | { assigned: false; kycStatus: "none" | "verified" }
  | {
      assigned: true;
      kycStatus: "none" | "verified";
      tricycle: RiderTricycle;
      weeklyAmount: number;
      totalPaidUsdc: string;
      pricePaidPct: number;
      payments: RiderPaymentRow[];
    };

export function riderStatus(): Promise<RiderStatus> {
  return request<RiderStatus>("/rider/status");
}

export function claimTricycle(tricycleId: number): Promise<RiderStatus> {
  return request<RiderStatus>("/rider/claim", {
    method: "POST",
    body: JSON.stringify({ tricycleId }),
  });
}

export function payWeekly(payload: { amountUsdc: string; pin: string }): Promise<{
  txHash: string;
  explorer: string;
  amountUsdc: string;
  yieldUsdc: string;
  yieldDistributed: boolean;
}> {
  return request("/rider/pay", { method: "POST", body: JSON.stringify(payload) });
}

// =============================================================================
// Savings
// =============================================================================

export type Savings = {
  id: number;
  driver_id: number;
  balance_usdc: number;
  created_at: string;
};

export function getSavingsBalance(driverId: number): Promise<Savings> {
  return request<Savings>(`/api/savings/${driverId}/balance`);
}

export function deposit(payload: {
  driver_id: number;
  amount_usdc: number;
}): Promise<Savings> {
  return request<Savings>("/api/savings/deposit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// =============================================================================
// Payments (driver weekly repayments)
// =============================================================================

export type PaymentStatus = "pending" | "confirmed" | "failed";

export type Payment = {
  id: number;
  driver_id: number;
  tricycle_id: number;
  amount_local: number;
  amount_usdc: number;
  currency: string;
  status: PaymentStatus;
  week_number: number;
  created_at: string;
};

export function recordPayment(payload: {
  driver_id: number;
  tricycle_id: number;
  amount_local: number;
  amount_usdc: number;
  currency: string;
  week_number: number;
}): Promise<Payment> {
  return request<Payment>("/api/payments", {
    method: "POST",
    body: JSON.stringify({ ...payload, status: "pending" }),
  });
}

export function listPayments(driverId: number): Promise<Payment[]> {
  return request<Payment[]>(`/api/payments/driver/${driverId}`);
}

// =============================================================================
// Waitlist (public — pre-launch landing page)
// =============================================================================

export type WaitlistEntry = {
  id: number;
  email: string;
  phone?: string;
  referral_code: string;
  referred_by?: string;
  position: number;
  created_at: string;
};

export type JoinResponse = {
  entry: WaitlistEntry;
  totalCount: number;
};

export type StatsResponse = {
  totalCount: number;
};

export type GetByCodeResponse = {
  entry: WaitlistEntry;
  totalCount: number;
  referralCount: number;
};

export function joinWaitlist(payload: {
  email: string;
  phone?: string;
  referredBy?: string;
}): Promise<JoinResponse> {
  return request<JoinResponse>("/waitlist/join", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}

export function getWaitlistStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/waitlist/stats", { skipAuth: true });
}

export function getWaitlistEntry(code: string): Promise<GetByCodeResponse> {
  return request<GetByCodeResponse>(`/waitlist/${encodeURIComponent(code)}`, {
    skipAuth: true,
  });
}
