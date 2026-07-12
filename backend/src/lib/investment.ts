// On-chain layer for the investment stack. Mirrors lib/chain.ts: low-level
// reads/writes against TricycleNFT + FractionalInvestment. The relayer sponsors
// gas; investor txs are signed by the user's own embedded-wallet key.

import { createWalletClient, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { erc20Abi } from "./abi.js";
import { tricycleNftAbi, investmentAbi } from "./investmentAbi.js";
import { publicClient, relayerClient, arcTestnet, confirm, rpcTransport } from "./chain.js";
import { decrypt } from "./crypto.js";

const NFT = config.tricycleNftAddress;
const INV = config.investmentAddress;

export interface OnchainTricycle {
  id: number;
  vehicleId: string;
  make: string;
  model: string;
  isEV: boolean;
  priceUsd: number;
  rangeKm: number;
}

export interface OnchainPool {
  pricePerShareRaw: bigint; // USDC 6dp per share
  totalShares: bigint;
  sharesSold: bigint;
  active: boolean;
}

/** How many tricycle NFTs have been minted (ids are 1..nextId-1). */
export async function tricycleCount(): Promise<number> {
  const next = await publicClient.readContract({
    address: NFT,
    abi: tricycleNftAbi,
    functionName: "nextId",
  });
  return Number(next) - 1;
}

export async function getTricycleMeta(id: number): Promise<OnchainTricycle> {
  const [vehicleId, make, model, isEV, priceUsd, rangeKm] =
    await publicClient.readContract({
      address: NFT,
      abi: tricycleNftAbi,
      functionName: "meta",
      args: [BigInt(id)],
    });
  return {
    id,
    vehicleId,
    make,
    model,
    isEV,
    priceUsd: Number(priceUsd),
    rangeKm: Number(rangeKm),
  };
}

export async function getPool(id: number): Promise<OnchainPool> {
  const [pricePerShareRaw, totalShares, sharesSold, , active] =
    await publicClient.readContract({
      address: INV,
      abi: investmentAbi,
      functionName: "pools",
      args: [BigInt(id)],
    });
  return { pricePerShareRaw, totalShares, sharesSold, active };
}

/** Shares an investor holds in a given tricycle pool. */
export async function sharesOf(id: number, account: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: INV,
    abi: investmentAbi,
    functionName: "balanceOf",
    args: [account, BigInt(id)],
  });
}

/** Total claimable USDC yield (raw 6dp) for an investor in a pool. */
export async function pendingYieldRaw(
  id: number,
  account: `0x${string}`,
): Promise<bigint> {
  return publicClient.readContract({
    address: INV,
    abi: investmentAbi,
    functionName: "pendingYield",
    args: [BigInt(id), account],
  });
}

// Gas safety-net for the two user txs (approve + invest). On Arc gas is paid in
// native USDC (same pool as the user's USDC), so an investor already has gas —
// this only catches a near-empty wallet. Amounts are the 18-dp native view.
const MIN_GAS = parseEther("0.02");
const TOPUP_GAS = parseEther("0.05"); // covers approve + invest

async function ensureGas(address: `0x${string}`) {
  const bal = await publicClient.getBalance({ address });
  if (bal < MIN_GAS) {
    const hash = await relayerClient.sendTransaction({ to: address, value: TOPUP_GAS });
    await confirm(hash);
  }
}

function userClientFrom(encryptedKey: string) {
  const account = privateKeyToAccount(decrypt(encryptedKey) as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: arcTestnet,
    transport: rpcTransport(),
  });
  return { account, client };
}

export interface InvestResult {
  txHash: string;
  costRaw: bigint;
}

/**
 * Buy `shares` of a tricycle from the user's embedded wallet. Approves the
 * exact USDC cost to the investment contract, then calls invest(). The relayer
 * sponsors gas. Returns the invest tx hash + cost (raw 6dp).
 */
export async function invest(
  encryptedKey: string,
  tricycleId: number,
  shares: bigint,
): Promise<InvestResult> {
  const pool = await getPool(tricycleId);
  const costRaw = shares * pool.pricePerShareRaw;
  const { account, client } = userClientFrom(encryptedKey);

  await ensureGas(account.address);

  const approveHash = await client.writeContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [INV, costRaw],
  });
  await confirm(approveHash);

  const txHash = await client.writeContract({
    address: INV,
    abi: investmentAbi,
    functionName: "invest",
    args: [BigInt(tricycleId), shares],
  });
  await confirm(txHash);

  return { txHash, costRaw };
}

/**
 * Distribute a yield amount (USDC) to a pool's investors as the platform owner
 * (relayer). Approves the USDC then calls distributeYield. Returns the tx hash,
 * or null if the amount is zero or the pool has no investors yet (the contract
 * would revert with "no shareholders").
 */
export async function distributeYieldFromOwner(
  tricycleId: number,
  amount: string,
): Promise<string | null> {
  const amt = parseUnits(amount, 6);
  if (amt === 0n) return null;

  const pool = await getPool(tricycleId);
  if (pool.sharesSold === 0n) return null; // nobody to pay yet

  const approveHash = await relayerClient.writeContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [INV, amt],
  });
  await confirm(approveHash);

  const txHash = await relayerClient.writeContract({
    address: INV,
    abi: investmentAbi,
    functionName: "distributeYield",
    args: [BigInt(tricycleId), amt],
  });
  await confirm(txHash);
  return txHash;
}

/** Claim accrued USDC yield for a pool from the user's embedded wallet. */
export async function claimYield(
  encryptedKey: string,
  tricycleId: number,
): Promise<string> {
  const { account, client } = userClientFrom(encryptedKey);
  await ensureGas(account.address);
  const txHash = await client.writeContract({
    address: INV,
    abi: investmentAbi,
    functionName: "claimYield",
    args: [BigInt(tricycleId)],
  });
  await confirm(txHash);
  return txHash;
}
