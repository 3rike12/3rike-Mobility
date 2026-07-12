import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getEvmBalance } from "@/lib/api";

/**
 * Pure "receive crypto" flow: shows the user's wallet address + a real QR,
 * the user sends USDC from their own wallet (e.g. MetaMask), and we detect the
 * real on-chain arrival by polling the balance. No minting — the only credit
 * is the user's actual transfer, so amounts can never double-count.
 */
export default function ReceiveCrypto({
  address,
  onReceived,
}: {
  address: string;
  onReceived: (receivedUsdc: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const startBalance = useRef<number | null>(null);

  // Capture the starting balance so we can detect the delta the user sends.
  useEffect(() => {
    let active = true;
    getEvmBalance()
      .then((b) => {
        if (active && startBalance.current === null) startBalance.current = Number(b.totalUsdc);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const check = async () => {
    setChecking(true);
    setNote(null);
    // Establish a baseline if we don't have one yet.
    if (startBalance.current === null) {
      try {
        startBalance.current = Number((await getEvmBalance()).totalUsdc);
      } catch {
        startBalance.current = 0;
      }
    }
    const start = startBalance.current ?? 0;
    // Poll the chain for ~30s for the incoming transfer.
    for (let i = 0; i < 10; i++) {
      try {
        const total = Number((await getEvmBalance()).totalUsdc);
        if (total > start + 1e-6) {
          setChecking(false);
          onReceived(total - start);
          return;
        }
      } catch {
        // transient — keep polling
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    setChecking(false);
    setNote("No transfer detected yet — it can take a few seconds. Tap to check again.");
  };

  return (
    <div className="flex flex-col items-center w-full">
      <p className="text-gray-400 text-xs text-center mb-4">
        Send USDC on Arc to your wallet address below.
      </p>

      {/* Real QR of the wallet address */}
      <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm mb-4">
        {address ? (
          <QRCodeSVG value={address} size={196} level="M" marginSize={2} fgColor="#0A0A0A" />
        ) : (
          <div className="w-49 h-49 bg-gray-100 rounded-xl" />
        )}
      </div>

      <div className="w-full bg-gray-50 rounded-2xl p-3 mb-5 flex items-center gap-2">
        <code className="flex-1 text-[11px] text-gray-600 font-mono break-all leading-relaxed">
          {address || "—"}
        </code>
        <button
          onClick={copy}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-[11px] font-medium text-gray-600 hover:bg-gray-100 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#01C259]" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
      </div>

      {note && <p className="text-xs text-amber-600 text-center mb-3">{note}</p>}

      <button
        onClick={check}
        disabled={checking}
        className="w-full h-14 bg-[#01C259] hover:bg-[#00a049] text-white font-medium text-base rounded-xl cursor-pointer disabled:opacity-70 inline-flex items-center justify-center gap-2"
      >
        {checking ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Waiting for your transfer…
          </>
        ) : (
          "I've sent it"
        )}
      </button>
    </div>
  );
}
