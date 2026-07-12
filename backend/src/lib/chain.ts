import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  formatUnits,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { erc20Abi, vaultAbi } from "./abi.js";
import { decrypt } from "./crypto.js";

// Arc testnet (Circle's L1). USDC is the NATIVE gas token: the native balance
// (18-dp "gas view") and the canonical USDC ERC-20 at config.usdcAddress
// (6-dp "balance view") are the SAME pool of funds. We use the ERC-20 view for
// all app balances/transfers, and the native view only for gas. So holding
// USDC inherently means having gas — no separate gas asset to juggle.
export const arcTestnet = defineChain({
  id: config.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
});

// Generous timeout + automatic retries on every transport (testnet RPCs can be
// slow/flaky). Use `rpcTransport()` for any wallet client created elsewhere too.
export const rpcTransport = () =>
  http(config.rpcUrl, { timeout: 30_000, retryCount: 4, retryDelay: 1500 });

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: rpcTransport(),
});

// Platform relayer/treasury: holds real USDC, funds users, distributes yield,
// and sponsors gas. Keep it funded with testnet USDC from https://faucet.circle.com
export const relayer = privateKeyToAccount(config.relayerPrivateKey);
export const relayerClient = createWalletClient({
  account: relayer,
  chain: arcTestnet,
  transport: rpcTransport(),
});

const USDC_DECIMALS = 6;

/**
 * Wait for a tx receipt with settings tuned for a testnet RPC that can be slow.
 * Without this, viem's default timeout can fire on a tx that actually lands —
 * making a successful write look like a failure (and risking a double-submit).
 */
export function confirm(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
    pollingInterval: 2_000,
    retryCount: 10,
  });
}

export function explorerTx(hash: string): string {
  return `${arcTestnet.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${arcTestnet.blockExplorers.default.url}/address/${address}`;
}

/** Raw USDC balance (smallest unit, 6dp ERC-20 view) of an address. */
export async function usdcBalanceRaw(address: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

/** Human-readable USDC balance string (6dp). */
export async function usdcBalance(address: `0x${string}`): Promise<string> {
  const raw = await usdcBalanceRaw(address);
  return formatUnits(raw, USDC_DECIMALS);
}

/** Value (in USDC) of a user's position in the yield vault, if deployed. */
export async function vaultPositionUsdc(address: `0x${string}`): Promise<string> {
  if (!config.vaultAddress) return "0";
  const raw = await publicClient.readContract({
    address: config.vaultAddress,
    abi: vaultAbi,
    functionName: "maxWithdraw",
    args: [address],
  });
  return formatUnits(raw, USDC_DECIMALS);
}

/**
 * Credit USDC to an address by transferring REAL Circle USDC from the platform
 * relayer (Arc USDC is Circle-issued — there is no open mint). Used to settle
 * confirmed fiat deposits, disburse loans, and fund demo wallets. The relayer
 * must hold enough USDC (faucet: https://faucet.circle.com). Returns the tx hash.
 *
 * Note: because USDC is Arc's native gas asset, transferring USDC also tops up
 * the recipient's gas — so a funded user can immediately transact.
 */
export async function fundUsdc(to: `0x${string}`, amount: string): Promise<string> {
  const value = parseUnits(amount, USDC_DECIMALS);
  const hash = await relayerClient.writeContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, value],
  });
  await confirm(hash);
  return hash;
}

// Gas safety-net: if a wallet's native (USDC) balance is too low to cover gas,
// the relayer sends it a tiny amount. Rarely needed — any wallet holding USDC
// already has gas (same pool) — so this only catches brand-new, zero-balance
// wallets. Amounts are in the 18-dp native USDC view.
const MIN_GAS = parseEther("0.05");
const TOPUP_GAS = parseEther("0.1");

/**
 * Withdraw USDC from a user's embedded wallet to an external address. The
 * relayer sponsors gas if needed, then the user's own key signs the ERC-20
 * transfer. Returns the tx hash.
 */
export async function withdrawUsdc(
  encryptedKey: string,
  to: `0x${string}`,
  amount: string,
): Promise<string> {
  const account = privateKeyToAccount(decrypt(encryptedKey) as `0x${string}`);

  // Sponsor gas if the wallet's native USDC can't cover the transfer fee.
  const nativeBal = await publicClient.getBalance({ address: account.address });
  if (nativeBal < MIN_GAS) {
    const fund = await relayerClient.sendTransaction({
      to: account.address,
      value: TOPUP_GAS,
    });
    await confirm(fund);
  }

  const userClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: rpcTransport(),
  });
  const value = parseUnits(amount, USDC_DECIMALS);
  const hash = await userClient.writeContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, value],
  });
  await confirm(hash);
  return hash;
}
