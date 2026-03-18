# x402 + SIWX: Token-Gated Free Access

A payment-gated API endpoint using [x402](https://x402.org) and [SIWX](https://x402.org) (Sign-In with X) that checks a Solana wallet's ZAUTH (SPL token) balance on Solana mainnet. Wallets holding >= 402 ZAUTH get free access. Everyone else pays $0.02 USDC on Base Sepolia.

No database, no external services — just a real-time on-chain balance query via public RPC.

## How It Works

```
GET /api/random (no headers)
  → 402 Payment Required
  → Response includes: payment info ($0.02 USDC) + SIWX challenge + token-gate extension

GET /api/random + SIGN-IN-WITH-X header (Solana wallet, ed25519)
  → Server verifies SIWX signature
  → Extracts Solana wallet address
  → Queries ZAUTH SPL token balance on Solana mainnet:
      >= 402 ZAUTH → 200 OK (free access, no payment)
      < 402 ZAUTH  → 402 (payment required)

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
middleware.ts              # x402 + SIWX + Solana SPL token balance gate (core logic)
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
# Solana wallet for signing SIWX in tests (must hold >= 402 ZAUTH on Solana mainnet)
SVM_WALLET_ADDRESS=YourSolanaAddress
SVM_PRIVATE_KEY=YourBase58PrivateKey

# EVM payer wallet (needs USDC on Base Sepolia for payment tests)
NON_ALLOWLISTED_WALLET_ADDRESS=0xPayerAddress
NON_ALLOWLISTED_WALLET_PRIVATE_KEY=0xPayerPrivateKey

# Token gate config
TOKEN_GATE_SOLANA_RPC=https://api.mainnet-beta.solana.com
TOKEN_GATE_MINT=DNhQZ1CE9qZ2FNrVhsCXwQJ2vZG8ufZkcYakTS5Jpump
TOKEN_GATE_MIN_BALANCE=402
```

### 3. Fund the wallets

| Wallet | Needs |
|--------|-------|
| `SVM_WALLET_*` | >= 402 ZAUTH on Solana mainnet (for free access) |
| `NON_ALLOWLISTED_WALLET_*` | ETH + USDC on Base Sepolia (for payment tests) |

Get USDC from the [Circle faucet](https://faucet.circle.com/).

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
| 3 | Funded Solana wallet (>= 402 ZAUTH) signs SIWX, gets free access (200, no payment) |
| 4 | Empty Solana wallet (0 ZAUTH) signs SIWX, still gets 402 (must pay) |
| 5 | Payer wallet signs SIWX + pays $0.02 USDC, gets 200 |

### Quick balance check

```bash
npm run test:quick
```

Signs in with the configured Solana wallet and checks if the ZAUTH balance qualifies for free access.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `TOKEN_GATE_SOLANA_RPC` | `https://api.mainnet-beta.solana.com` | Solana RPC endpoint for balance queries |
| `TOKEN_GATE_MINT` | — | SPL token mint address (ZAUTH) |
| `TOKEN_GATE_MIN_BALANCE` | `402` | Minimum ZAUTH token balance for free access |

## Key Files Explained

### `middleware.ts`

The entire gate lives here. Key parts:

- **Balance checker** — uses `@solana/spl-token` to query the ZAUTH associated token account on Solana mainnet, compares balance against `TOKEN_GATE_MIN_BALANCE`
- **Route config** — protects `GET /api/random` at $0.02 USDC on Base Sepolia (`eip155:84532`), declares SIWX (Solana ed25519) + `token-gate` extensions
- **Gate hook** (`onProtectedRequest`) — validates SIWX signature, extracts Solana wallet address, checks on-chain ZAUTH balance, returns `{ grantAccess: true }` to bypass payment for qualifying wallets

### `app/api/random/route.ts`

Returns `{ "number": 1-9 }`. Only reachable if your wallet holds enough ZAUTH (free) or you pay.

## How It Differs from the Allowlist Pattern

| Aspect | Allowlist | Token Gate |
|--------|-----------|------------|
| Gate check | `Set.has(address)` | On-chain SPL token balance |
| External dependency | None (env var) | Solana RPC |
| Gate pass outcome | Free access | Free access |
| Gate fail outcome | Must pay | Must pay |
| Dynamic | No (restart to update) | Yes (real-time balance) |

The token gate is dynamic — if a wallet acquires tokens after being denied, the next request will grant free access automatically.

## Tech Stack

- [Next.js](https://nextjs.org) — app framework
- [x402](https://x402.org) — HTTP 402 payment protocol
- [@x402/extensions](https://www.npmjs.com/package/@x402/extensions) — SIWX (Sign-In with X) extension with Solana ed25519 support
- [@solana/web3.js](https://www.npmjs.com/package/@solana/web3.js) + [@solana/spl-token](https://www.npmjs.com/package/@solana/spl-token) — Solana RPC + SPL token balance queries
- [viem](https://viem.sh) — EVM wallet for USDC payment fallback
- Solana mainnet — token gate checks ZAUTH (`DNhQZ1CE9qZ2FNrVhsCXwQJ2vZG8ufZkcYakTS5Jpump`)
- Base Sepolia — testnet (`eip155:84532`, payments in USDC)
