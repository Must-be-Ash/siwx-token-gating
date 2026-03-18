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
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

const payTo = "0xF7C645b7600Fb6AaE07Fd0Cf31112A7788BE8F85";

// Solana SPL token balance checker
const connection = new Connection(
  process.env.TOKEN_GATE_SOLANA_RPC || "https://api.mainnet-beta.solana.com"
);
const TOKEN_MINT = new PublicKey(process.env.TOKEN_GATE_MINT!);
const MIN_BALANCE = parseInt(process.env.TOKEN_GATE_MIN_BALANCE || "402", 10);

async function checkTokenBalance(
  address: string
): Promise<{ hasEnough: boolean; balance: number }> {
  try {
    const owner = new PublicKey(address);
    const ata = getAssociatedTokenAddressSync(TOKEN_MINT, owner);
    const account = await getAccount(connection, ata);
    const balance = Number(account.amount);

    return {
      hasEnough: balance >= MIN_BALANCE,
      balance,
    };
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      return { hasEnough: false, balance: 0 };
    }
    throw err;
  }
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
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      }),
      "token-gate": {
        description:
          "Hold >= 402 ZAUTH (DNhQZ1CE9qZ2FNrVhsCXwQJ2vZG8ufZkcYakTS5Jpump) on Solana for free access",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        token: "DNhQZ1CE9qZ2FNrVhsCXwQJ2vZG8ufZkcYakTS5Jpump",
        standard: "SPL",
        name: "zauthx402",
        ticker: "ZAUTH",
        minBalance: "402",
      },
    },
  },
};

/**
 * Token gate hook — wallets with sufficient ZAUTH balance get free access, others pay.
 *
 * Flow:
 * - No SIWX, no payment         → fall through → 402 with extensions
 * - Payment without SIWX        → ABORT 403
 * - SIWX valid + enough ZAUTH   → GRANT ACCESS (free, bypass payment)
 * - SIWX valid + low ZAUTH      → fall through to payment
 * - SIWX invalid                → ABORT
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
