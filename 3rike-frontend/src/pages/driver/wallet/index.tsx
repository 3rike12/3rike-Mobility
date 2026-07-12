import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
} from "lucide-react";
import MobileFrame from "@/components/ui/mobile-frame";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useWalletBalance } from "@/lib/use-wallet-balance";
import ReceiveCrypto from "@/components/receive-crypto";
import Skeleton from "@/components/ui/skeleton";

export default function Wallet() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const address = user?.walletAddress ?? "";

  const {
    balance,
    loading: loadingBalance,
    error: balanceErrorObj,
    refresh: loadBalance,
  } = useWalletBalance();
  const balanceError = balanceErrorObj ? messageFor(balanceErrorObj) : null;

  const [copied, setCopied] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [justReceived, setJustReceived] = useState<number | null>(null);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleReceived = (amount: number) => {
    setDepositOpen(false);
    setJustReceived(amount);
    void loadBalance();
    setTimeout(() => setJustReceived(null), 6000);
  };

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  return (
    <MobileFrame innerClassName="flex flex-col">
      {/* Header */}
      <header className="px-5 pt-6 pb-2 flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-[#E9F8EE] hover:bg-[#d8f1e0] cursor-pointer"
          type="button"
        >
          <ChevronLeft className="w-5 h-5 text-[#01C259]" />
        </Button>
        <h1 className="font-semibold text-lg text-gray-900">Wallet</h1>
        <button
          type="button"
          onClick={() => void loadBalance()}
          disabled={loadingBalance}
          className="ml-auto p-2 rounded-full hover:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer"
          aria-label="Refresh balance"
        >
          <RefreshCw className={`w-4 h-4 text-gray-500 ${loadingBalance ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="flex-1 px-5 pb-8 pt-2 flex flex-col">
        {/* Hero balance card */}
        <div className="relative w-full rounded-3xl p-6 text-white overflow-hidden mb-4 bg-[#00C258]">
          <img
            src="/earnings-banner.svg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-50 z-0"
            aria-hidden
          />
          <div className="relative z-10">
            <p className="text-xs text-white/80 mb-1">Total balance</p>
            {loadingBalance && !balance ? (
              <Skeleton className="h-10 w-48 bg-white/20" />
            ) : (
              <h1 className="text-4xl font-bold mb-1">
                $ {formatUSDC(balance?.totalUsdc)}{" "}
                <span className="text-sm font-light text-white/80 align-middle">USDC</span>
              </h1>
            )}
            <p className="text-[11px] text-white/70 mt-2">Arc · live on-chain balance</p>
          </div>
        </div>

        {justReceived !== null && (
          <div className="mb-3 flex items-center gap-2 bg-[#E9F8EE] text-[#067a3a] rounded-xl px-4 py-3 text-sm">
            <Check className="w-4 h-4" /> Received ${formatUSDC(String(justReceived))} USDC
          </div>
        )}

        {balanceError && (
          <p className="text-xs text-red-500 text-center mb-3" role="alert">
            {balanceError}
          </p>
        )}

        {/* Breakdown */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-[10px] text-[#909090] uppercase tracking-wider mb-1">Spendable</p>
            <p className="text-base font-bold text-gray-900">{formatUSDC(balance?.walletUsdc)}</p>
            <p className="text-[10px] text-[#909090] mt-0.5">In wallet</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="w-3.5 h-3.5 text-[#909090]" />
              <p className="text-[10px] text-[#909090] uppercase tracking-wider">Saved</p>
            </div>
            <p className="text-base font-bold text-gray-900">{formatUSDC(balance?.vaultUsdc)}</p>
            <p className="text-[10px] text-[#909090] mt-0.5">Earning yield</p>
          </div>
        </div>

        {/* Wallet address */}
        <div className="bg-[#F8FAFC] rounded-2xl p-4 mb-4">
          <p className="text-[10px] text-[#909090] uppercase tracking-wider mb-2">
            Your wallet address
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] text-gray-700 font-mono truncate">{short}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50 cursor-pointer"
              aria-label="Copy address"
            >
              {copied ? (
                <><Check className="w-3 h-3 text-[#01C259]" /> Copied</>
              ) : (
                <><Copy className="w-3 h-3" /> Copy</>
              )}
            </button>
            {balance?.explorer && (
              <a
                href={balance.explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
              >
                <ExternalLink className="w-3 h-3" /> View
              </a>
            )}
          </div>
        </div>

        {/* Deposit CTA */}
        <Button
          onClick={() => setDepositOpen(true)}
          className="h-12 bg-[#01C259] hover:bg-[#00a049] text-white rounded-xl font-medium cursor-pointer gap-2"
        >
          <ArrowDownToLine className="w-4 h-4" /> Deposit crypto (USDC)
        </Button>
      </div>

      {/* Deposit (receive) sheet */}
      {depositOpen && (
        <div className="absolute inset-0 z-50 bg-black/40 flex items-end justify-center animate-in fade-in duration-200">
          <div className="w-full bg-white rounded-t-3xl p-6 pb-8 animate-in slide-in-from-bottom duration-300">
            <div className="mx-auto w-12 h-2 bg-gray-300 rounded-full mb-6" />
            <h3 className="text-xl font-bold text-gray-900 text-center mb-4">Deposit USDC</h3>
            <ReceiveCrypto address={address} onReceived={handleReceived} />
            <button
              type="button"
              onClick={() => setDepositOpen(false)}
              className="w-full mt-3 h-11 rounded-xl border border-gray-200 text-gray-600 text-sm cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </MobileFrame>
  );
}

function formatUSDC(raw?: string): string {
  if (raw === undefined) return "0.00";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "timeout") return "The server is waking up — please try again.";
    if (err.code === "network_error") return "Couldn't reach the server.";
  }
  return "Something went wrong. Please try again.";
}
