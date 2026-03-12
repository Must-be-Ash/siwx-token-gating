# x402 + SIWX: Allowlist (VIP Free Access)

A payment-gated API endpoint using [x402](https://x402.org) and [SIWX](https://x402.org) (Sign-In with X) that gives allowlisted wallets free access. Everyone else pays.

This is the simplest possible SIWX gate pattern — no database, no on-chain checks, no external services. The entire gate logic is a `Set.has()` call against an env var.

## How It Works

```
GET /api/random (no headers)
  → 402 Payment Required
  → Response includes: payment info ($0.02 USDC) + SIWX challenge + allowlist extension

GET /api/random + SIGN-IN-WITH-X header
  → Server verifies SIWX signature
  → Extracts wallet address
  → Checks allowlist:
      Allowlisted     → 200 OK (free access, no payment)
      Not allowlisted → 402 (payment required)

GET /api/random + SIGN-IN-WITH-X + PAYMENT-SIGNATURE
  → Not on allowlist, but paid → 200 OK
```

## Use Cases

- **Beta / Early Access** — let testers use your paid API for free before launch
- **Partner Access** — give partners free access via wallet identity instead of API keys
- **Investor Preview** — stakeholders get complimentary access to paid endpoints
- **Internal Tooling** — your team's wallets bypass the paywall for debugging

## Project Structure

```
middleware.ts              # x402 + SIWX + allowlist gate (core logic)
app/api/random/route.ts    # Protected endpoint (random number 1-9)
test-endpoint.ts           # Full test suite (6 tests)
test-allowlist.ts          # Quick allowlist check
test-funded.ts             # Manual test with funded wallet
.env.example               # Template for required env vars
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure wallets

Copy the example env file:

```bash
cp .env.example .env.local
```

You need three wallets for the test suite:

| Env Var | Purpose | Needs Funds? |
|---------|---------|:---:|
| `ALLOWLISTED_WALLET_*` | On the VIP list, gets free access | No |
| `NON_ALLOWLISTED_WALLET_*` | Not on the list, must pay | Yes (ETH + USDC on Base Sepolia) |
| `UNFUNDED_WALLET_*` | Not on the list, can't pay either | No |

Generate wallets with any EVM wallet tool, or use `viem`:

```typescript
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
console.log(account.address, key);
```

Add the allowlisted wallet's address to `ALLOWLIST_ADDRESSES`:

```env
ALLOWLIST_ADDRESSES=0xYourAllowlistedWalletAddress
```

You can add multiple addresses, comma-separated.

### 3. Fund the non-allowlisted wallet

The non-allowlisted wallet needs Base Sepolia testnet tokens to pay $0.02 USDC per request:

- Get Base Sepolia ETH from a faucet
- Get Base Sepolia USDC from the [USDC faucet](https://faucet.circle.com/)

### 4. Start the server

```bash
npm run dev
```

### 5. Verify the 402 response

```bash
curl -i http://localhost:3000/api/random
```

You should see a `402 Payment Required` response with `payment-required` header containing both `sign-in-with-x` and `allowlist` extensions.

## Test Suite

### Full test suite (6 tests)

```bash
npm test
```

| Test | What it checks |
|------|---------------|
| 1 | `GET /api/random` returns 402 with SIWX + allowlist extensions |
| 2 | Payment without SIWX is blocked (403) |
| 3 | Allowlisted wallet signs SIWX, gets free access (200, no payment) |
| 4 | Non-allowlisted wallet signs SIWX, still gets 402 (must pay) |
| 5 | Non-allowlisted wallet signs SIWX + pays, gets 200 |
| 6 | Unfunded wallet tries to pay, fails (no USDC) |

### Quick allowlist check

```bash
npm run test:quick
```

Signs in with the allowlisted wallet and checks if free access is granted.

## Key Files Explained

### `middleware.ts`

The entire gate lives here. Key parts:

- **Allowlist parsing** — reads `ALLOWLIST_ADDRESSES` from env, splits by comma, normalizes to lowercase, stores in a `Set` for O(1) lookup
- **Route config** — protects `GET /api/random` at $0.02 USDC on Base Sepolia, declares SIWX + allowlist extensions
- **Gate hook** (`onProtectedRequest`) — validates SIWX signature, checks if the wallet is allowlisted, returns `{ grantAccess: true }` to bypass payment for VIPs

### `app/api/random/route.ts`

Returns `{ "number": 1-9 }`. Only reachable if you're allowlisted (free) or you pay.

## Tech Stack

- [Next.js](https://nextjs.org) — app framework
- [x402](https://x402.org) — HTTP 402 payment protocol
- [@x402/extensions](https://www.npmjs.com/package/@x402/extensions) — SIWX (Sign-In with X) extension
- [viem](https://viem.sh) — EVM wallet operations
- Base Sepolia — testnet for payments ($0.02 USDC)
# siwx-allowlist
