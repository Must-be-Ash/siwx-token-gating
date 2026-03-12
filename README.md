# x402 + SIWX: Token-Gated Free Access

A payment-gated API endpoint using [x402](https://x402.org) and [SIWX](https://x402.org) (Sign-In with X) that checks a wallet's ETH balance on Base Sepolia. Wallets holding >= 0.0001 ETH get free access. Everyone else pays $0.02 USDC.

No database, no external services — just a real-time on-chain balance query via public RPC.

## How It Works

```
GET /api/random (no headers)
  → 402 Payment Required
  → Response includes: payment info ($0.02 USDC) + SIWX challenge + token-gate extension

GET /api/random + SIGN-IN-WITH-X header
  → Server verifies SIWX signature
  → Extracts wallet address
  → Queries ETH balance on Base Sepolia via public RPC:
      >= 0.0001 ETH → 200 OK (free access, no payment)
      < 0.0001 ETH  → 402 (payment required)

GET /api/random + SIGN-IN-WITH-X + PAYMENT-SIGNATURE
  → Balance too low, but paid → 200 OK
```

## Use Cases

- **Token holder perks** — reward users who hold your token with free API access
- **Loyalty tiers** — different balance thresholds for different access levels
- **Community access** — holders of a project's token get free access to project APIs
- **Freemium gating** — anyone can pay, but holders get it free

## Project Structure

```
middleware.ts              # x402 + SIWX + token balance gate (core logic)
app/api/random/route.ts    # Protected endpoint (random number 1-9)
test-endpoint.ts           # Full test suite (5 tests)
test-siwx-balance.ts       # Quick balance check
.env.local                 # Wallet keys + RPC URL + min balance
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local`:

```env
# Wallet for signing SIWX in tests (must hold >= 0.0001 ETH on Base Sepolia)
X402_WALLET_ADDRESS=0xYourWalletAddress
X402_WALLET_PRIVATE_KEY=0xYourPrivateKey

# Payer wallet (needs USDC on Base Sepolia for payment tests)
NON_ALLOWLISTED_WALLET_ADDRESS=0xPayerAddress
NON_ALLOWLISTED_WALLET_PRIVATE_KEY=0xPayerPrivateKey

# Token gate config
TOKEN_GATE_RPC_URL=https://sepolia.base.org
TOKEN_GATE_MIN_BALANCE=0.0001
```

### 3. Fund the wallets

| Wallet | Needs |
|--------|-------|
| `X402_WALLET_*` | >= 0.0001 ETH on Base Sepolia (for free access) |
| `NON_ALLOWLISTED_WALLET_*` | ETH + USDC on Base Sepolia (for payment tests) |

Get Base Sepolia ETH from a faucet, and USDC from the [Circle faucet](https://faucet.circle.com/).

### 4. Start the server

```bash
npm run dev
```

### 5. Verify the 402 response

```bash
curl -i http://localhost:3000/api/random
```

You should see a `402 Payment Required` response with `payment-required` header containing both `sign-in-with-x` and `token-gate` extensions.

## Test Suite

### Full test suite (5 tests)

```bash
npm test
```

| Test | What it checks |
|------|---------------|
| 1 | `GET /api/random` returns 402 with SIWX + `token-gate` extensions (correct minBalance) |
| 2 | Payment without SIWX is blocked (403) |
| 3 | Funded wallet (>= 0.0001 ETH) signs SIWX, gets free access (200, no payment) |
| 4 | Empty wallet (0 ETH) signs SIWX, still gets 402 (must pay) |
| 5 | Payer wallet signs SIWX + pays $0.02 USDC, gets 200 |

### Quick balance check

```bash
npm run test:quick
```

Signs in with the configured wallet and checks if the token balance qualifies for free access.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TOKEN_GATE_RPC_URL` | `https://sepolia.base.org` | RPC endpoint for balance queries |
| `TOKEN_GATE_MIN_BALANCE` | `0.0001` | Minimum ETH balance for free access (in ether) |

## Key Files Explained

### `middleware.ts`

The entire gate lives here. Key parts:

- **Balance checker** — uses `viem` to create a public client for Base Sepolia, calls `getBalance()`, compares against `parseEther(TOKEN_GATE_MIN_BALANCE)`
- **Route config** — protects `GET /api/random` at $0.02 USDC on Base Sepolia (`eip155:84532`), declares SIWX + `token-gate` extensions
- **Gate hook** (`onProtectedRequest`) — validates SIWX signature, extracts wallet address, checks on-chain balance, returns `{ grantAccess: true }` to bypass payment for qualifying wallets

### `app/api/random/route.ts`

Returns `{ "number": 1-9 }`. Only reachable if your wallet holds enough ETH (free) or you pay.

## How It Differs from the Allowlist Pattern

| Aspect | Allowlist | Token Gate |
|--------|-----------|------------|
| Gate check | `Set.has(address)` | On-chain `getBalance()` |
| External dependency | None (env var) | Public RPC |
| Gate pass outcome | Free access | Free access |
| Gate fail outcome | Must pay | Must pay |
| Dynamic | No (restart to update) | Yes (real-time balance) |

The token gate is dynamic — if a wallet acquires tokens after being denied, the next request will grant free access automatically.

## Tech Stack

- [Next.js](https://nextjs.org) — app framework
- [x402](https://x402.org) — HTTP 402 payment protocol
- [@x402/extensions](https://www.npmjs.com/package/@x402/extensions) — SIWX (Sign-In with X) extension
- [viem](https://viem.sh) — EVM wallet + public client for balance queries
- Base Sepolia — testnet (`eip155:84532`, payments in USDC, gate checks native ETH)
# siwx-token-gating
