import {
  paymentProxyFromHTTPServer,
  x402ResourceServer,
  x402HTTPResourceServer,
} from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  declareSIWxExtension,
  siwxResourceServerExtension,
  parseSIWxHeader,
  validateSIWxMessage,
  verifySIWxSignature,
} from "@x402/extensions/sign-in-with-x";
import { createPublicClient, http, parseEther, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const payTo = "0xF7C645b7600Fb6AaE07Fd0Cf31112A7788BE8F85";

// Token balance checker via public RPC
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.TOKEN_GATE_RPC_URL || "https://sepolia.base.org"),
});

const MIN_BALANCE = parseEther(process.env.TOKEN_GATE_MIN_BALANCE || "0.0001");

async function checkTokenBalance(
  address: string
): Promise<{ hasEnough: boolean; balance: string }> {
  const balance = await publicClient.getBalance({
    address: address as `0x${string}`,
  });
  return {
    hasEnough: balance >= MIN_BALANCE,
    balance: formatEther(balance),
  };
}

// x402 resource server setup
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme())
  .registerExtension(siwxResourceServerExtension);

const routes = {
  "/api/random": {
    accepts: [
      {
        scheme: "exact" as const,
        price: "$0.02",
        network: "eip155:84532" as const,
        payTo,
      },
    ],
    description: "Get a random number 1-9",
    mimeType: "application/json",
    extensions: {
      ...declareSIWxExtension({
        statement:
          "Sign in to verify token balance for free access to random number generator",
        expirationSeconds: 300,
      }),
      "token-gate": {
        description: "Hold >= 0.0001 ETH on Base Sepolia for free access",
        network: "eip155:84532",
        token: "ETH",
        minBalance: "0.0001",
        unit: "ether",
      },
    },
  },
};

/**
 * Token gate hook — wallets with sufficient ETH balance get free access, others pay.
 *
 * Flow:
 * - No SIWX, no payment      → fall through → 402 with extensions
 * - Payment without SIWX     → ABORT 403
 * - SIWX valid + enough ETH  → GRANT ACCESS (free, bypass payment)
 * - SIWX valid + low ETH     → fall through to payment
 * - SIWX invalid             → ABORT
 */
function createTokenGateHook() {
  return async (context: {
    adapter: { getHeader(name: string): string | undefined; getUrl(): string };
    path: string;
  }) => {
    const siwxHeader = context.adapter.getHeader("sign-in-with-x");
    const hasPayment = !!context.adapter.getHeader("payment-signature");

    // No SIWX, no payment → 402 with extensions (tells client what to do)
    if (!siwxHeader && !hasPayment) {
      return;
    }

    // Trying to pay without SIWX → block
    if (!siwxHeader && hasPayment) {
      return {
        abort: true as const,
        reason: "Sign in with your wallet first.",
      };
    }

    // SIWX header present — validate it
    try {
      const payload = parseSIWxHeader(siwxHeader!);
      const resourceUri = context.adapter.getUrl();

      const validation = await validateSIWxMessage(payload, resourceUri);
      if (!validation.valid) {
        return {
          abort: true as const,
          reason: `Invalid signature: ${validation.error}`,
        };
      }

      const verification = await verifySIWxSignature(payload);
      if (!verification.valid) {
        return {
          abort: true as const,
          reason: `Signature verification failed: ${verification.error}`,
        };
      }

      const address = verification.address!;

      // Check on-chain token balance
      const { hasEnough, balance } = await checkTokenBalance(address);

      if (hasEnough) {
        // Free access bypass — skip payment, serve the endpoint directly
        return { grantAccess: true as const };
      }

      // Insufficient balance → fall through to payment verification
      return;
    } catch (err) {
      return {
        abort: true as const,
        reason: `Token gate error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

const httpServer = new x402HTTPResourceServer(
  resourceServer,
  routes
).onProtectedRequest(createTokenGateHook());

export const middleware = paymentProxyFromHTTPServer(httpServer);

export const runtime = "nodejs";

export const config = {
  matcher: ["/api/:path*"],
};
