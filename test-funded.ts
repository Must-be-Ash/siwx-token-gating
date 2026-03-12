/**
 * Test with the non-allowlisted (funded) wallet.
 * Test 1 (pay):  Wallet is NOT on allowlist → must pay → 200
 * Test 2 (free): Wallet IS on allowlist → SIWX only, no payment → 200
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
} from "@x402/extensions/sign-in-with-x";

const ENDPOINT = "http://localhost:3000/api/random";
const PRIVATE_KEY = process.env.NON_ALLOWLISTED_WALLET_PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error("Missing NON_ALLOWLISTED_WALLET_PRIVATE_KEY in .env.local");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const signer = toClientEvmSigner(account, publicClient);

console.log(`Non-allowlisted wallet: ${account.address}\n`);

function decode402(header: string) {
  return JSON.parse(Buffer.from(header, "base64").toString());
}

async function getSIWxHeader(): Promise<string | null> {
  const res = await fetch(ENDPOINT);
  const header = res.headers.get("payment-required");
  if (!header) return null;
  const decoded = decode402(header);
  const siwxExt = decoded?.extensions?.["sign-in-with-x"];
  if (!siwxExt?.info || !siwxExt?.supportedChains?.length) return null;
  const chain = siwxExt.supportedChains[0];
  const completeInfo = { ...siwxExt.info, chainId: chain.chainId, type: chain.type };
  const payload = await createSIWxPayload(completeInfo, account);
  return encodeSIWxHeader(payload);
}

const testName = process.argv[2];

// ─── Test 1: NOT on allowlist → SIWX + payment → 200 ───
async function testPay() {
  console.log("═══ Test: NOT on allowlist → must pay ═══");

  const siwxHeaderValue = await getSIWxHeader();
  if (!siwxHeaderValue) {
    console.log("FAIL: Could not get SIWX challenge");
    return false;
  }

  const fetchWithSIWx = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : init?.headers,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }
    headers.set("SIGN-IN-WITH-X", siwxHeaderValue);
    return fetch(input, { ...init, headers });
  };

  const client = new x402Client().register("eip155:84532", new ExactEvmScheme(signer));
  const fetchWithPay = wrapFetchWithPayment(fetchWithSIWx, client);

  try {
    const res = await fetchWithPay(ENDPOINT);
    console.log(`Status: ${res.status}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`Response: ${JSON.stringify(data)}`);
      console.log("PASS: Paid and got data");
      return true;
    }
    const body = await res.text();
    console.log(`Body: ${body}`);
    console.log("FAIL");
    return false;
  } catch (err) {
    console.log(`Error: ${err}`);
    console.log("FAIL");
    return false;
  }
}

// ─── Test 2: ON allowlist → SIWX only, no payment → 200 ───
async function testFree() {
  console.log("═══ Test: ON allowlist → free access via SIWX ═══");

  const siwxHeaderValue = await getSIWxHeader();
  if (!siwxHeaderValue) {
    console.log("FAIL: Could not get SIWX challenge");
    return false;
  }

  const res = await fetch(ENDPOINT, {
    headers: { "SIGN-IN-WITH-X": siwxHeaderValue },
  });
  console.log(`Status: ${res.status}`);

  if (res.ok) {
    const data = await res.json();
    console.log(`Response: ${JSON.stringify(data)}`);
    console.log("PASS: Free VIP access — no payment needed");
    return true;
  }
  const body = await res.text();
  console.log(`Body: ${body}`);
  console.log("FAIL");
  return false;
}

if (testName === "pay") {
  testPay().catch(console.error);
} else if (testName === "free") {
  testFree().catch(console.error);
} else {
  console.log("Usage: npx tsx test-funded.ts [pay|free]");
}
