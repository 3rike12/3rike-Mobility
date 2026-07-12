import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Pencil } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import MobileFrame from "@/components/ui/mobile-frame";
import Avatar from "@/components/ui/avatar";

export default function SettingsProfile() {
    const navigate = useNavigate();
    const { user, updateProfile } = useAuth();
    const [copied, setCopied] = useState(false);

    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState({
        fullName: user?.fullName ?? "",
        phone: user?.phone ?? "",
        country: user?.country ?? "",
        address: user?.address ?? "",
    });

    const fullName = user?.fullName || user?.email?.split("@")[0] || "—";
    const firstName = fullName.split(" ")[0];
    const address = user?.walletAddress ?? "";
    const walletShort = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";

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

    const startEdit = () => {
        setForm({
            fullName: user?.fullName ?? "",
            phone: user?.phone ?? "",
            country: user?.country ?? "",
            address: user?.address ?? "",
        });
        setError(null);
        setEditing(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            await updateProfile({
                fullName: form.fullName.trim(),
                phone: form.phone.trim(),
                country: form.country.trim(),
                address: form.address.trim(),
            });
            setEditing(false);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? "Couldn't save your changes. Please try again."
                    : "Something went wrong.",
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <MobileFrame innerBg="bg-[#F8FAFC]" innerClassName="flex flex-col">
            {/* --- Header --- */}
            <div className="relative flex items-center justify-center pt-12 pb-6 px-6 bg-[#F8FAFC]">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate(-1)}
                    className="absolute left-6 w-10 h-10 rounded-full bg-[#F3F8F5] hover:bg-green-50 text-[#01C259] transition-colors cursor-pointer"
                >
                    <ChevronLeft className="w-6 h-6" />
                </Button>

                <h1 className="font-semibold text-lg text-black">My Profile</h1>

                {!editing && (
                    <button
                        type="button"
                        onClick={startEdit}
                        className="absolute right-6 inline-flex items-center gap-1 text-[#01C259] text-sm font-medium cursor-pointer"
                    >
                        <Pencil className="w-4 h-4" /> Edit
                    </button>
                )}
            </div>

            {/* --- Main Content --- */}
            <div className="flex-1 px-6 pb-10 flex flex-col items-center gap-8">
                {/* Profile Picture & Name */}
                <div className="flex flex-col items-center gap-3 mt-4">
                    <Avatar name={fullName} size={72} />
                    <h2 className="text-gray-500 font-medium text-base">{firstName}</h2>
                </div>

                {/* Wallet Address Card — EVM wallet, tap to open wallet page */}
                <div
                    onClick={() => navigate("/driver/wallet")}
                    className="w-full bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                >
                    <span className="text-gray-900 font-medium text-sm">Wallet</span>
                    <div className="flex items-center gap-3">
                        <span className="text-gray-400 font-mono text-[12px]">{walletShort}</span>
                        {address ? (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void handleCopy();
                                }}
                                className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                                aria-label="Copy wallet address"
                            >
                                {copied ? <Check className="w-5 h-5 text-[#01C259]" /> : <Copy className="w-5 h-5" />}
                            </button>
                        ) : (
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        )}
                    </div>
                </div>

                {/* Personal Details Card */}
                <div className="w-full bg-white rounded-xl overflow-hidden">
                    {/* Full Name */}
                    <Field label="Full Name">
                        {editing ? (
                            <EditInput
                                value={form.fullName}
                                onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
                                placeholder="Your full name"
                            />
                        ) : (
                            <span className="text-gray-400 text-sm">{user?.fullName || "—"}</span>
                        )}
                    </Field>

                    {/* Email (read-only here) */}
                    <Field label="Email">
                        <span className="text-gray-400 text-sm truncate max-w-40">{user?.email ?? "—"}</span>
                    </Field>

                    {/* Mobile Number */}
                    <Field label="Mobile Number">
                        {editing ? (
                            <EditInput
                                value={form.phone}
                                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                                placeholder="080..."
                                inputMode="tel"
                            />
                        ) : (
                            <span className="text-gray-400 text-sm">{user?.phone || "—"}</span>
                        )}
                    </Field>

                    {/* Country */}
                    <Field label="Country">
                        {editing ? (
                            <EditInput
                                value={form.country}
                                onChange={(v) => setForm((f) => ({ ...f, country: v }))}
                                placeholder="Nigeria"
                            />
                        ) : (
                            <span className="text-gray-400 text-sm">{user?.country || "—"}</span>
                        )}
                    </Field>

                    {/* Address */}
                    <Field label="Address" last>
                        {editing ? (
                            <EditInput
                                value={form.address}
                                onChange={(v) => setForm((f) => ({ ...f, address: v }))}
                                placeholder="Street, city"
                            />
                        ) : (
                            <span className="text-gray-400 text-sm truncate max-w-40">
                                {user?.address || "—"}
                            </span>
                        )}
                    </Field>
                </div>

                {error && (
                    <p className="text-sm text-red-500 text-center" role="alert">
                        {error}
                    </p>
                )}

                {editing && (
                    <div className="w-full flex gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => setEditing(false)}
                            className="flex-1 h-12 rounded-xl border border-gray-200 text-gray-700 cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={saving}
                            onClick={handleSave}
                            className="flex-1 h-12 rounded-xl bg-[#01C259] hover:bg-[#00a049] text-white font-medium cursor-pointer disabled:opacity-60"
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </Button>
                    </div>
                )}

                {!editing && address && (
                    <a
                        href={`https://testnet.arcscan.app/address/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#01C259] hover:underline"
                    >
                        View wallet on explorer <ExternalLink className="w-3 h-3" />
                    </a>
                )}
            </div>
        </MobileFrame>
    );
}

function Field({
    label,
    children,
    last,
}: {
    label: string;
    children: React.ReactNode;
    last?: boolean;
}) {
    return (
        <div
            className={`flex items-center justify-between p-3 ${last ? "" : "border-b border-gray-50"}`}
        >
            <span className="text-gray-900 font-medium text-sm shrink-0">{label}</span>
            <div className="flex-1 flex justify-end pl-3">{children}</div>
        </div>
    );
}

function EditInput({
    value,
    onChange,
    placeholder,
    inputMode,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    inputMode?: "tel" | "text";
}) {
    return (
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            inputMode={inputMode}
            className="w-full max-w-44 text-right text-sm text-gray-800 bg-gray-50 rounded-lg px-3 py-1.5 outline-none focus:bg-white focus:ring-1 focus:ring-[#01C259]"
        />
    );
}
