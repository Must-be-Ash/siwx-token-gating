# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A payment-gated API using the [x402](https://x402.org) protocol with [SIWX](https://x402.org) (Sign-In with X) and on-chain token gating. The single protected endpoint (`GET /api/random`) returns a random number 1-9. Solana wallets holding >= 402 ZAUTH (SPL token `DNhQZ1CE9qZ2FNrVhsCXwQJ2vZG8ufZkcYakTS5Jpump`) on Solana mainnet get free access; everyone else pays $0.02 USDC on Base Sepolia.

## Commands

- `npm run dev` — start Next.js dev server (localhost:3000)
- `npm run build` — production build
- `npm run lint` — ESLint (flat config, Next.js core-web-vitals + TypeScript)
- `npm test` — full test suite (5 tests, requires dev server running + funded wallets)
- `npm run test:quick` — quick SIWX balance check (requires dev server running)

Tests are standalone TypeScript scripts run via `npx tsx`, not a test framework. They hit `http://localhost:3000/api/random` and require `.env.local` with wallet keys.

## Architecture

All gate logic lives in **`middleware.ts`** — there is no separate auth layer or database. The middleware:

1. Sets up an x402 resource server with EVM exact payment scheme on Base Sepolia (`eip155:84532`) and SIWX extension configured for Solana mainnet
2. Defines route config for `/api/random` with payment price, SIWX challenge params (Solana ed25519), and a custom `token-gate` extension advertising ZAUTH
3. Implements `onProtectedRequest` hook (`createTokenGateHook`) that runs before x402 payment verification:
   - No SIWX + no payment → fall through → 402 with extensions
   - Payment without SIWX → abort 403
   - SIWX valid + ZAUTH balance >= 402 → `{ grantAccess: true }` (free, skips payment)
   - SIWX valid + ZAUTH balance < 402 → fall through to payment verification
   - SIWX invalid → abort

The balance check uses `@solana/spl-token`'s `getAccount` to query the ZAUTH associated token account on Solana mainnet on every request (no caching).

## Key Dependencies

- **@x402/next, @x402/core, @x402/evm, @x402/extensions, @x402/fetch** — x402 protocol (payment middleware, SIWX extension, client-side payment wrapping)
- **@solana/web3.js, @solana/spl-token** — Solana RPC connection and SPL token balance queries
- **@solana/kit** — Solana keypair signing for SIWX in tests
- **viem** — EVM wallet operations (used for USDC payment fallback)
- **Next.js 16** with App Router, React 19, Tailwind CSS v4

## Environment Variables

Defined in `.env.local` (see `.env.example` for template):
- `SVM_WALLET_ADDRESS` / `SVM_PRIVATE_KEY` — Solana wallet holding ZAUTH (for SIWX free access path)
- `NON_ALLOWLISTED_WALLET_ADDRESS` / `NON_ALLOWLISTED_WALLET_PRIVATE_KEY` — EVM payer wallet (needs USDC on Base Sepolia for payment tests)
- `TOKEN_GATE_SOLANA_RPC` — Solana RPC endpoint (defaults to `https://api.mainnet-beta.solana.com`)
- `TOKEN_GATE_MINT` — SPL token mint address (ZAUTH: `DNhQZ1CE9qZ2FNrVhsCXwQJ2vZG8ufZkcYakTS5Jpump`)
- `TOKEN_GATE_MIN_BALANCE` — minimum ZAUTH tokens for free access (defaults to `402`)

## Path Alias

`@/*` maps to project root (configured in `tsconfig.json`).
