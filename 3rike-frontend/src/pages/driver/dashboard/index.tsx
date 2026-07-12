import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Plus, TrendingUp } from "lucide-react";
import DepositModal from "../deposit";
import WithdrawModal from "../withdraw/modal";
import BottomNav from "@/components/ui/bottom-nav";
import Avatar from "@/components/ui/avatar";
import Skeleton from "@/components/ui/skeleton";
import HowItWorks, { shouldShowHowItWorks } from "./how-it-works";
import { useAuth } from "@/lib/auth";
import { useSavings } from "@/lib/use-savings";
import { useEarnings } from "@/lib/use-earnings";
import { useWalletBalance } from "@/lib/use-wallet-balance";
import { usdToNgnRate } from "@/lib/api";

// Verification banner states, driven by the server-side user.kycStatus:
//   - not_started: KYC not done → "Start Verification" CTA
//   - 3riker:      KYC verified → "My future 3rike" card
// (in_progress / approved are retained in the union for the banner copy paths.)
type VerificationStatus = "not_started" | "in_progress" | "approved" | "3riker";

export default function DriverDashboard() {
  const navigate = useNavigate();
  const { user, driver } = useAuth();
  const { balance: savingsBalance, isLoading: savingsLoading, refresh: refreshSavings } = useSavings();
  const { total: lifetimeEarnings, loading: earningsLoading } = useEarnings();
  const {
    balance: walletBalance,
    loading: walletLoading,
    refresh: refreshWallet,
  } = useWalletBalance();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(
    user?.kycStatus === "verified" ? "3riker" : "not_started",
  );

  // State to control the modals
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

  // Wallet-balance currency toggle: USD (USDC) <-> Naira equivalent.
  const [showNgn, setShowNgn] = useState(false);
  const [ngnRate, setNgnRate] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    usdToNgnRate()
      .then((r) => {
        if (!cancelled) setNgnRate(r.ngnPerUsdc);
      })
      .catch(() => {
        /* leave null — toggle just stays on USD */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // First-run "How 3rike works" overlay — initialized from localStorage so
  // returning users don't re-see it.
  const [howItWorksOpen, setHowItWorksOpen] = useState(() => shouldShowHowItWorks());

  // Verification status is SERVER-DRIVEN (user.kycStatus) — it follows the
  // account everywhere (incognito, other devices), no localStorage.
  useEffect(() => {
    setVerificationStatus(user?.kycStatus === "verified" ? "3riker" : "not_started");
  }, [user?.kycStatus]);

  // Auto-refresh balances when the tab regains focus — covers the case where
  // a user pays/deposits inside the app and the OS pauses our JS, or where
  // they hit the back button after a deeper flow.
  useEffect(() => {
    const onFocus = () => {
      void refreshSavings();
      void refreshWallet();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshSavings, refreshWallet]);

  const handleLoan = () => {
    navigate("/driver/loan");
  };

  const handleSavings = () => {
    navigate("/driver/savings");
  };
  const handleInvestment = () => {
    navigate("/driver/investment");
  };
  const handleVerification = () => {
    if (verificationStatus === "approved") {
      navigate("/driver/own-3rike");
      return;
    }
    if (verificationStatus === "3riker") {
      navigate("/driver/3rike-details");
      return;
    }
    navigate("/driver/verification");
  };
  return (
    <div className="min-h-screen bg-white flex justify-center">
      {/* Mobile Frame Container */}
      <div className="w-full max-w-100 bg-white shadow-2xl overflow-hidden min-h-200 relative pb-10">
        {/* Header Profile — tap to open the profile page */}
        <div className="px-6 flex items-center justify-between pt-6 mb-4">
          <button
            type="button"
            onClick={() => navigate("/driver/settings")}
            className="flex items-center gap-3 bg-white rounded-full cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Avatar
              name={user?.fullName || driver?.full_name || user?.email || "rider"}
              size={40}
              className="border-2 border-white"
            />
            <span className="font-light text-sm -mr-5 text-left">
              {greetingFor(new Date())},{" "}
              <span className="font-medium">{firstNameOf(user?.fullName || driver?.full_name, user?.email)}</span>
            </span>
            <Button variant="link" tabIndex={-1}>
              <img src="arrow.svg" alt="Arrow" className="w-5 h-5" />
            </Button>
          </button>
        </div>

        {/* Main Content Scroll Area */}
        <div className="px-5 space-y-4">
          {/* 1. GREEN BALANCE CARD */}
          <div className="relative w-full rounded-3xl p-6 text-white overflow-hidden">
            {/* Background Gradient & Blobs */}
            <img
              src="/earnings-banner.svg"
              alt="Card Background"
              className="absolute inset-0 w-full h-full bg-[#00C258] object-cover z-0"
            />

            <div className="relative z-10">
              <div
                onClick={() => navigate("/driver/wallet")}
                className="cursor-pointer"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-green-100 text-sm font-light">
                    Wallet Balance
                  </span>
                  <span className="text-green-100/80 text-[10px] font-light">
                    Arc
                  </span>
                </div>

                <div className="flex flex-row justify-between mb-6 min-h-12">
                  {walletLoading && !walletBalance ? (
                    <Skeleton className="h-10 w-40 bg-white/20" />
                  ) : (
                    <h1 className="text-4xl font-bold">
                      {showNgn && ngnRate != null ? (
                        <>
                          ₦ {formatNgn(Number(walletBalance?.totalUsdc ?? 0) * ngnRate)}
                          <span className="text-base font-light text-white/80 ml-1.5 align-middle">
                            NGN
                          </span>
                        </>
                      ) : (
                        <>
                          $ {formatCC(walletBalance?.totalUsdc)}
                          <span className="text-base font-light text-white/80 ml-1.5 align-middle">
                            USDC
                          </span>
                        </>
                      )}
                    </h1>
                  )}
                </div>
              </div>

              <div className="flex gap-4">
                <Button
                  onClick={() => setIsDepositOpen(true)}
                  className="flex-1 bg-transparent hover:bg-white/30 text-white border border-white rounded-full h-12 gap-2 text-sm font-medium backdrop-blur-sm"
                >
                  <div className="bg-white text-[#00C258] rounded-full p-0.5 w-5 h-5 flex items-center justify-center">
                    <Plus size={14} strokeWidth={4} />
                  </div>
                  Deposit
                </Button>

                <Button
                  onClick={() => setIsWithdrawOpen(true)}
                  className="flex-1 bg-transparent hover:bg-white/30 text-white border border-white rounded-full h-12 gap-2 text-sm font-medium backdrop-blur-sm"
                >
                  <div className="bg-white text-[#00C258] rounded-full p-0.5 w-5 h-5 flex items-center justify-center">
                    <ArrowUpRight size={14} strokeWidth={4} />
                  </div>
                  Withdraw
                </Button>
              </div>
            </div>

            {/* USD <-> Naira toggle (vertical) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowNgn((v) => !v);
              }}
              disabled={ngnRate == null}
              aria-label={showNgn ? "Show balance in USD" : "Show balance in Naira"}
              title={showNgn ? "Showing Naira — tap for USD" : "Tap to show Naira"}
              className="absolute right-5 top-8 z-20 w-8 h-14 mt-1.5 rounded-full bg-black/15 border border-white/25 disabled:opacity-40 cursor-pointer"
            >
              <span
                className="absolute left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white text-[#00C258] flex items-center justify-center text-xs font-bold transition-all duration-200"
                style={{ top: showNgn ? "calc(100% - 1.625rem)" : "0.125rem" }}
              >
                {showNgn ? "₦" : "$"}
              </span>
            </button>
          </div>

          {/* 2. STATS ROW */}
          <div className="grid grid-cols-2 gap-4">
            {/* Savings Balance */}
            <div className="bg-white border-3 border-dashed border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                <img src="wallet.svg" alt="Back" className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Savings Balance</p>
                {savingsLoading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  <h3 className="text-xl font-light text-gray-800">
                    ${" "}{formatBalance(savingsBalance)}
                  </h3>
                )}
              </div>
            </div>

            {/* Lifetime Earnings — sum of yield payouts */}
            <div className="bg-white border-3 border-dashed border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#FFF7EC] flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-[#EE9C2E]" />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Lifetime Earnings</p>
                {earningsLoading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  <h3 className="text-xl font-light text-gray-800">
                    $ {formatBalance(lifetimeEarnings)}
                  </h3>
                )}
              </div>
            </div>
          </div>

          {/* 3. VERIFICATION BANNER */}
          {verificationStatus === "3riker" ? (
            // "My future 3rike" variant — shown after the user becomes a 3riker
            <div
              onClick={handleVerification}
              className="relative w-full rounded-2xl px-4 py-3 overflow-hidden text-white flex items-center justify-between cursor-pointer"
            >
              <img
                src="/future-3rike.svg"
                alt="Card Background"
                className="absolute inset-0 w-full h-full bg-[#1E8A32] object-cover z-0"
              />
              <div className="relative z-10 max-w-[66%]">
                <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center mb-2 backdrop-blur-md">
                  <img
                    src="/verification-bike.svg"
                    alt="bike"
                    className="absolute inset-0 w-full h-full object-cover z-0"
                  />
                </div>

                <h3 className="font-bold text-[14px] leading-tight">
                  My future 3rike
                </h3>

                <p className="text-[12px] text-white/90 mt-0.5 leading-snug">
                  Contribute your weekly fees and check out specs.{" "}
                  <span className="inline-flex items-center gap-1 text-[#01C259] font-medium">
                    Click here
                    <img
                      src="/arrows_right_line.svg"
                      alt="arrow"
                      className="w-4 h-4"
                    />
                  </span>
                </p>
              </div>
              <img
                src="/future-33rike.svg"
                alt="3rike"
                className="relative z-10 min-w-[120px] h-full -mr-2"
              />
            </div>
          ) : (
            <div
              onClick={handleVerification}
              className="relative w-full bg-[#1B8036] rounded-2xl p-5 overflow-hidden text-white flex items-center justify-between cursor-pointer"
            >
              <img
                src={verificationStatus === "approved" ? "/own-a-3rike.svg" : "/verification-banner.svg"}
                alt="Card Background"
                className="absolute inset-0 w-full h-full bg-[#1E8A32] object-cover z-0"
              />

              <div className="relative z-10">
                <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center mb-2 backdrop-blur-md">
                  <img
                    src="/verification-bike.svg"
                    alt="bike"
                    className="absolute inset-0 w-full h-full object-cover z-0"
                  />
                </div>

                <h3 className="font-bold text-lg leading-tight">
                  {verificationStatus === "not_started" && "Start Verification"}
                  {verificationStatus === "in_progress" &&
                    "Verification in Progress"}
                  {verificationStatus === "approved" && "Own a 3rike"}
                </h3>

                <p className="text-sm text-white mt-0.5">
                  {verificationStatus === "not_started" &&
                    "Complete Kyc and be eligible."}
                  {verificationStatus === "in_progress" &&
                    "Details received. We’ll be in touch soon."}
                  {verificationStatus === "approved" &&
                    "Continue to get your 3rike"}
                </p>
              </div>

              <div className="absolute bottom-4 right-4 z-10 w-8 h-8 bg-[#00C258] rounded-full flex items-center justify-center shadow-lg">
                <Button variant="link">
                  <img
                    src="/arrow-right.svg"
                    alt="arrow"
                    className="absolute inset-0 w-full h-full object-cover z-0"
                  />
                </Button>
              </div>
            </div>
          )}

          {/* 4. BOTTOM GRID MENU */}
          <div className="grid grid-cols-2 gap-4">
            {/* Savings */}
            <div
              onClick={handleSavings}
              className="bg-white border-3 border-dashed border-gray-100 rounded-2xl p-4 flex flex-col  gap-2 cursor-pointer"
            >
              <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center mb-2 backdrop-blur-md">
                <img
                  src="/piggy.svg"
                  alt="piggy"
                  className="absolute inset-0 w-full h-full  object-cover z-0"
                />
              </div>
              <span className="text-gray-800 text-lg">Savings</span>
            </div>

            {/* Investment */}
            <div
              onClick={handleInvestment}
              className="bg-white border-3 border-dashed border-gray-100 rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
            >
              <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center mb-2 backdrop-blur-md">
                <img
                  src="/invest.svg"
                  alt="invest"
                  className="absolute inset-0 w-full h-full  object-cover z-0"
                />
              </div>
              <span className="text-gray-800 text-lg">Investment</span>
            </div>

            {/* Earn */}
            <div className="bg-white border-3 border-dashed border-gray-100 rounded-2xl p-4 flex flex-col gap-2 ">
              <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center mb-2 backdrop-blur-md">
                <img
                  src="/chart.svg"
                  alt="chart"
                  className="absolute inset-0 w-full h-full  object-cover z-0"
                />
              </div>
              <span className="text-gray-800 text-lg">Earn</span>
            </div>

            {/* Loan */}
            <div
              onClick={handleLoan}
              className="bg-white border-3 border-dashed border-gray-100 rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
            >
              <div className="w-5 h-5 bg-white/20 rounded-lg flex items-center justify-center mb-2 backdrop-blur-md">
                <img
                  src="/loan.svg"
                  alt="loan"
                  className="absolute inset-0 w-full h-full  object-cover z-0"
                />
              </div>
              <span className="text-gray-800 text-lg">Loan</span>
            </div>
          </div>
        </div>

        <BottomNav />

        {/* First-run onboarding — only shows once per browser */}
        {howItWorksOpen && <HowItWorks onClose={() => setHowItWorksOpen(false)} />}
      </div>

      {/* deposit modal */}
      <DepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        onDeposited={() => {
          void refreshWallet();
          void refreshSavings();
        }}
      />

      {/* Withdraw modal */}
      <WithdrawModal
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        onWithdrawn={() => {
          void refreshWallet();
          void refreshSavings();
        }}
      />
    </div>
  );
}

// Maps the backend driver record onto the dashboard's UX states. The
function formatBalance(usdc: number): string {
  return usdc.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function greetingFor(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameOf(fullName?: string, email?: string): string {
  if (fullName && fullName.trim()) return fullName.trim().split(/\s+/)[0]!;
  if (email) return email.split("@")[0]!;
  return "rider";
}

function formatCC(raw?: string): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Naira equivalent — whole-naira with thousands separators (₦ rarely shows kobo).
function formatNgn(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
