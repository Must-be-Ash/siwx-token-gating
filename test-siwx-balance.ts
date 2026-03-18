/**
 * Quick test — checks if the Solana wallet gets free access via ZAUTH token balance gate.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import {
  encodeSIWxHeader,
  createSIWxPayload,
  type SolanaSigner,
} from "@x402/extensions/sign-in-with-x";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

const ENDPOINT = "http://localhost:3000/api/random";
const SVM_KEY = process.env.SVM_PRIVATE_KEY;

if (!SVM_KEY) {
  console.error("Missing SVM_PRIVATE_KEY in .env.local");
  process.exit(1);
}

function decode402(header: string) {
  return JSON.parse(Buffer.from(header, "base64").toString());
}

async function main() {
  const signer = await createKeyPairSignerFromBytes(
    base58.decode(SVM_KEY!)
  ) as unknown as SolanaSigner;

  console.log(`Wallet: ${(signer as any).address}`);

  // Step 1: Get 402 + SIWX challenge
  const res402 = await fetch(ENDPOINT);
  if (res402.status !== 402) {
    console.log(`Expected 402, got ${res402.status}`);
    return;
  }

  const header = res402.headers.get("payment-required");
  if (!header) {
    console.log("No payment-required header");
    return;
  }

  const decoded = decode402(header);
  const siwxExt = decoded?.extensions?.["sign-in-with-x"];
  if (!siwxExt?.info) {
    console.log("No SIWX extension in 402 response");
    return;
  }

  const tokenGate = decoded?.extensions?.["token-gate"];
  if (tokenGate) {
    console.log(`Token gate: min ${tokenGate.minBalance} ${tokenGate.ticker} on ${tokenGate.network}`);
  }

  // Step 2: Sign SIWX with Solana wallet
  const chain = siwxExt.supportedChains[0];
  const completeInfo = { ...siwxExt.info, chainId: chain.chainId, type: chain.type };
  const payload = await createSIWxPayload(completeInfo, signer);
  const siwxHeader = encodeSIWxHeader(payload);

  // Step 3: Send SIWX-only request
  const res = await fetch(ENDPOINT, {
    headers: { "SIGN-IN-WITH-X": siwxHeader },
  });

  console.log(`Status: ${res.status}`);

  if (res.ok) {
    const data = await res.json();
    console.log(`Free access granted! Result: ${JSON.stringify(data)}`);
  } else {
    console.log("Insufficient token balance — payment required.");
  }
}

main().catch(console.error);
