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
const payTo = "0xC55bBDD975256f88cD34Fe77F95A24660e5543AE";

// Parse allowlist from env — done once at module load
const ALLOWLIST: Set<string> = new Set(
  (process.env.ALLOWLIST_ADDRESSES || "")
    .split(",")
    .map((addr) => addr.trim().toLowerCase())
    .filter(Boolean)
);

function isAllowlisted(address: string): boolean {
  return ALLOWLIST.has(address.toLowerCase());
}

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
        statement: "Sign in to check VIP access for random number generator",
        expirationSeconds: 300,
      }),
      allowlist: {
        description: "VIP wallets get free access — sign in with SIWX to check",
      },
    },
  },
};

/**
 * Allowlist gate hook — VIP wallets get free access, others pay.
 *
 * Flow:
 * - No SIWX, no payment      → fall through → 402 with extensions
 * - Payment without SIWX     → ABORT 403
 * - SIWX valid + allowlisted → ABORT 200 (free access bypass)
 * - SIWX valid + NOT listed  → fall through to payment
 * - SIWX invalid             → ABORT
 */
function createAllowlistGateHook() {
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

      // Check allowlist
      if (isAllowlisted(address)) {
        // Free access bypass — skip payment, serve the endpoint directly
        return { grantAccess: true as const };
      }

      // Not allowlisted → fall through to payment verification
      return;
    } catch (err) {
      return {
        abort: true as const,
        reason: `Allowlist gate error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  .onProtectedRequest(createAllowlistGateHook());

export const middleware = paymentProxyFromHTTPServer(httpServer);

export const runtime = "nodejs";

export const config = {
  matcher: ["/api/:path*"],
};
