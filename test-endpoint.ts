/**
 * Test script for the x402-protected endpoint with Solana SPL token gate.
 * Wallets with >= 402 ZAUTH on Solana mainnet get free access. Others must pay.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import {
  encodeSIWxHeader,
  createSIWxPayload,
  type SolanaSigner,
} from "@x402/extensions/sign-in-with-x";
import { createKeyPairSignerFromBytes, generateKeyPairSigner } from "@solana/kit";
import { base58 } from "@scure/base";

const ENDPOINT = "http://localhost:3000/api/random";

const SVM_KEY = process.env.SVM_PRIVATE_KEY;
const PAYER_KEY = process.env
  .NON_ALLOWLISTED_WALLET_PRIVATE_KEY as `0x${string}`;

if (!SVM_KEY) {
  console.error("Missing SVM_PRIVATE_KEY in .env.local");
  process.exit(1);
}
if (!PAYER_KEY) {
  console.error("Missing NON_ALLOWLISTED_WALLET_PRIVATE_KEY in .env.local");
  process.exit(1);
}

// EVM payer account (for USDC payment fallback)
const payerAccount = privateKeyToAccount(PAYER_KEY);
const payerPublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});
const payerSigner = toClientEvmSigner(payerAccount, payerPublicClient);

// Initialized in main()
let fundedSigner: SolanaSigner;
let emptySigner: SolanaSigner;

function decode402(header: string) {
  return JSON.parse(Buffer.from(header, "base64").toString());
}

/** Get a fresh SIWX header by fetching the 402, signing the challenge */
async function getSIWxHeader(
  signer: SolanaSigner = fundedSigner
): Promise<string | null> {
  const res = await fetch(ENDPOINT);
  const header = res.headers.get("payment-required");
  if (!header) return null;
  const decoded = decode402(header);
  const siwxExt = decoded?.extensions?.["sign-in-with-x"];
  if (!siwxExt?.info || !siwxExt?.supportedChains?.length) return null;
  const chain = siwxExt.supportedChains[0];
  const completeInfo = {
    ...siwxExt.info,
    chainId: chain.chainId,
    type: chain.type,
  };
  const payload = await createSIWxPayload(completeInfo, signer);
  return encodeSIWxHeader(payload);
}

// ─── Test 1: 402 response structure ───
async function test1() {
  console.log("═══ Test 1: 402 with payment + token-gate extensions ═══");
  const res = await fetch(ENDPOINT);
  console.log(`Status: ${res.status}`);

  const header = res.headers.get("payment-required");
  if (res.status !== 402 || !header) {
    console.log("FAIL\n");
    return false;
  }

  const decoded = decode402(header);
  const siwx = decoded?.extensions?.["sign-in-with-x"];
  const tokenGate = decoded?.extensions?.["token-gate"];

  console.log(`sign-in-with-x: ${siwx ? "present" : "MISSING"}`);
  console.log(
    `token-gate: ${tokenGate ? JSON.stringify(tokenGate) : "MISSING"}`
  );

  const pass = !!siwx && !!tokenGate && tokenGate.minBalance === "402";
  console.log(pass ? "PASS\n" : "FAIL\n");
  return pass;
}

// ─── Test 2: Payment without SIWX is blocked ───
async function test2() {
  console.log("═══ Test 2: Payment WITHOUT SIWX is blocked ═══");

  const client = new x402Client().register(
    "eip155:84532",
    new ExactEvmScheme(payerSigner)
  );
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  try {
    const res = await fetchWithPay(ENDPOINT);
    console.log(`Status: ${res.status}`);
    const body = await res.text();
    console.log(`Body: ${body}`);

    if (res.status === 403 || res.status === 402) {
      console.log("PASS: Payment blocked without SIWX\n");
      return true;
    }
    if (res.ok) {
      console.log("FAIL: Payment went through without SIWX\n");
      return false;
    }
    return false;
  } catch (err) {
    console.log(`Error (expected): ${err}`);
    console.log("PASS: Payment blocked\n");
    return true;
  }
}

// ─── Test 3: SIWX with sufficient ZAUTH balance → free access ───
async function test3() {
  console.log(
    "═══ Test 3: Funded Solana wallet SIWX → free access (no payment) ═══"
  );

  const siwxHeaderValue = await getSIWxHeader();
  if (!siwxHeaderValue) {
    console.log("FAIL: Could not get SIWX challenge\n");
    return false;
  }

  const res = await fetch(ENDPOINT, {
    headers: { "SIGN-IN-WITH-X": siwxHeaderValue },
  });
  console.log(`Status: ${res.status}`);

  if (res.ok) {
    const data = await res.json();
    console.log(`Response: ${JSON.stringify(data)}`);
    const hasNumber =
      typeof data.number === "number" && data.number >= 1 && data.number <= 9;
    console.log(`Valid number (1-9): ${hasNumber}`);
    console.log(
      hasNumber ? "PASS: Free access granted\n" : "FAIL: Invalid response\n"
    );
    return hasNumber;
  }

  console.log(`FAIL: Expected 200, got ${res.status}\n`);
  return false;
}

// ─── Test 4: SIWX with insufficient balance → still 402 ───
async function test4() {
  console.log(
    "═══ Test 4: Empty Solana wallet SIWX → still 402 (needs payment) ═══"
  );
  console.log(`Using empty wallet: ${(emptySigner as any).address}`);

  const siwxHeaderValue = await getSIWxHeader(emptySigner);
  if (!siwxHeaderValue) {
    console.log("FAIL: Could not get SIWX challenge\n");
    return false;
  }

  const res = await fetch(ENDPOINT, {
    headers: { "SIGN-IN-WITH-X": siwxHeaderValue },
  });
  console.log(`Status: ${res.status}`);

  if (res.status === 402) {
    console.log("PASS: Empty wallet needs payment\n");
    return true;
  }
  console.log(`FAIL: Expected 402, got ${res.status}\n`);
  return false;
}

// ─── Test 5: SIWX with insufficient balance + payment → 200 ───
async function test5() {
  console.log("═══ Test 5: Payer wallet SIWX + payment → 200 ═══");
  console.log(`Using empty Solana wallet: ${(emptySigner as any).address}`);
  console.log(`Using EVM payer wallet: ${payerAccount.address}`);

  const siwxHeaderValue = await getSIWxHeader(emptySigner);
  if (!siwxHeaderValue) {
    console.log("FAIL: Could not get SIWX challenge\n");
    return false;
  }

  // Wrap fetch to always include SIWX header
  const fetchWithSIWx = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }
    headers.set("SIGN-IN-WITH-X", siwxHeaderValue);
    return fetch(input, { ...init, headers });
  };

  const client = new x402Client().register(
    "eip155:84532",
    new ExactEvmScheme(payerSigner)
  );
  const fetchWithPay = wrapFetchWithPayment(fetchWithSIWx, client);

  try {
    const res = await fetchWithPay(ENDPOINT);
    console.log(`Status: ${res.status}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`Response: ${JSON.stringify(data)}`);
      console.log("PASS: Paid and got result\n");
      return true;
    }
    const body = await res.text();
    console.log(`Body: ${body}`);
    console.log("FAIL\n");
    return false;
  } catch (err) {
    console.log(`Error: ${err}`);
    console.log("FAIL\n");
    return false;
  }
}

// ─── Run ───
async function main() {
  // Initialize Solana signers
  fundedSigner = await createKeyPairSignerFromBytes(
    base58.decode(SVM_KEY!)
  ) as unknown as SolanaSigner;
  emptySigner = await generateKeyPairSigner() as unknown as SolanaSigner;

  console.log(`Funded Solana wallet (>= 402 ZAUTH): ${(fundedSigner as any).address}`);
  console.log(`Empty Solana wallet (0 ZAUTH):       ${(emptySigner as any).address}`);
  console.log(`EVM payer wallet (has USDC):          ${payerAccount.address}\n`);

  const results: Record<string, boolean> = {};

  results["Test 1: 402 + token-gate extensions"] = await test1();
  results["Test 2: Payment blocked without SIWX"] = await test2();
  results["Test 3: Funded wallet free access"] = await test3();
  results["Test 4: Empty wallet needs payment"] = await test4();
  results["Test 5: Payer wallet SIWX + payment"] = await test5();

  console.log("═══ SUMMARY ═══");
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  }
}

main().catch(console.error);
