"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Flow Data ───

type Actor = "client" | "server" | "solana" | "facilitator";

interface Step {
  id: string;
  title: string;
  subtitle: string;
  from: Actor;
  to: Actor;
  label: string;
  request?: string;
  response?: string;
  highlight?: "success" | "warning" | "error" | "info";
  note?: string;
}

const PATH_A_STEPS: Step[] = [
  {
    id: "a1",
    title: "1. Initial Request",
    subtitle: "Client hits the endpoint with no headers",
    from: "client",
    to: "server",
    label: "GET /api/random",
    request: `GET /api/random HTTP/1.1
Host: localhost:3000`,
  },
  {
    id: "a2",
    title: "2. 402 Payment Required",
    subtitle: "Server responds with payment info + SIWX challenge + token gate",
    from: "server",
    to: "client",
    label: "402 + Extensions",
    highlight: "warning",
    response: `HTTP/1.1 402 Payment Required
payment-required: <base64 encoded>

{
  "accepts": [{ "price": "$0.02", "network": "eip155:84532" }],
  "extensions": {
    "sign-in-with-x": {
      "supportedChains": [
        { "chainId": "solana:5eykt4U...", "type": "ed25519" }
      ],
      "info": { "nonce": "41535e21...", "statement": "Sign in to verify..." }
    },
    "token-gate": {
      "ticker": "ZAUTH",
      "minBalance": "402",
      "network": "solana:5eykt4U..."
    }
  }
}`,
  },
  {
    id: "a3",
    title: "3. Sign SIWX Message",
    subtitle: "Client signs the challenge with their Solana wallet (ed25519)",
    from: "client",
    to: "client",
    label: "Wallet signs challenge",
    highlight: "info",
    note: "The wallet signs a structured message containing the nonce, domain, URI, and statement. This proves the client controls the private key.",
    request: `// Client-side signing
const payload = await createSIWxPayload(challengeInfo, solanaSigner);
const header = encodeSIWxHeader(payload);

// Signed payload includes:
{
  "address": "Fa2V4RxCA...G4NE",
  "chainId": "solana:5eykt4U...",
  "type": "ed25519",
  "signature": "<base58 ed25519 signature>"
}`,
  },
  {
    id: "a4",
    title: "4. Send SIWX Header",
    subtitle: "Client sends the signed SIWX message to the server",
    from: "client",
    to: "server",
    label: "GET + SIGN-IN-WITH-X",
    request: `GET /api/random HTTP/1.1
Host: localhost:3000
SIGN-IN-WITH-X: <base64 encoded signed payload>`,
  },
  {
    id: "a5",
    title: "5. Verify Signature",
    subtitle: "Server verifies the ed25519 SIWX signature and extracts the Solana address",
    from: "server",
    to: "server",
    label: "Verify ed25519",
    highlight: "info",
    note: "The server validates the nonce, expiration, domain, URI, then verifies the cryptographic signature to recover the Solana wallet address.",
  },
  {
    id: "a6",
    title: "6. Check On-Chain Balance",
    subtitle: "Server queries ZAUTH SPL token balance on Solana mainnet",
    from: "server",
    to: "solana",
    label: "getTokenAccount(address, ZAUTH mint)",
    request: `// Server-side balance check
const owner = new PublicKey("Fa2V4RxCA...G4NE");
const ata = getAssociatedTokenAddressSync(ZAUTH_MINT, owner);
const account = await getAccount(connection, ata);
// account.amount = 500`,
  },
  {
    id: "a7",
    title: "7. Balance Sufficient",
    subtitle: "500 ZAUTH >= 402 minimum \u2014 wallet qualifies for free access",
    from: "solana",
    to: "server",
    label: "500 ZAUTH",
    highlight: "success",
    response: `// Gate decision
balance: 500 ZAUTH
threshold: 402 ZAUTH
result: 500 >= 402 \u2192 grantAccess: true`,
  },
  {
    id: "a8",
    title: "8. Free Access Granted",
    subtitle: "Server bypasses payment entirely and serves the endpoint",
    from: "server",
    to: "client",
    label: "200 OK",
    highlight: "success",
    response: `HTTP/1.1 200 OK
Content-Type: application/json

{ "number": 7 }`,
    note: "No payment needed. No USDC spent. No facilitator contacted. The token gate short-circuits the entire payment flow.",
  },
];

const PATH_B_STEPS: Step[] = [
  {
    id: "b1",
    title: "1. Initial Request",
    subtitle: "Client hits the endpoint with no headers",
    from: "client",
    to: "server",
    label: "GET /api/random",
    request: `GET /api/random HTTP/1.1
Host: localhost:3000`,
  },
  {
    id: "b2",
    title: "2. 402 Payment Required",
    subtitle: "Server responds with payment info + SIWX challenge + token gate",
    from: "server",
    to: "client",
    label: "402 + Extensions",
    highlight: "warning",
    response: `HTTP/1.1 402 Payment Required
payment-required: <base64 encoded>

{
  "accepts": [{ "price": "$0.02", "network": "eip155:84532" }],
  "extensions": {
    "sign-in-with-x": { ... },
    "token-gate": { "ticker": "ZAUTH", "minBalance": "402" }
  }
}`,
  },
  {
    id: "b3",
    title: "3. Sign SIWX Message",
    subtitle: "Client signs the challenge with their Solana wallet (ed25519)",
    from: "client",
    to: "client",
    label: "Wallet signs challenge",
    highlight: "info",
  },
  {
    id: "b4",
    title: "4. Send SIWX Header",
    subtitle: "Client sends the signed SIWX message to the server",
    from: "client",
    to: "server",
    label: "GET + SIGN-IN-WITH-X",
    request: `GET /api/random HTTP/1.1
Host: localhost:3000
SIGN-IN-WITH-X: <base64 encoded signed payload>`,
  },
  {
    id: "b5",
    title: "5. Verify + Check Balance",
    subtitle: "Server verifies signature and queries ZAUTH balance on Solana mainnet",
    from: "server",
    to: "solana",
    label: "getTokenAccount(address, ZAUTH mint)",
  },
  {
    id: "b6",
    title: "6. Insufficient Balance",
    subtitle: "0 ZAUTH < 402 minimum \u2014 wallet does NOT qualify",
    from: "solana",
    to: "server",
    label: "0 ZAUTH",
    highlight: "error",
    response: `// Gate decision
balance: 0 ZAUTH
threshold: 402 ZAUTH
result: 0 < 402 \u2192 fall through to payment`,
  },
  {
    id: "b7",
    title: "7. Still 402 \u2014 Pay Up",
    subtitle: "Server falls through to x402 payment verification \u2014 client must pay $0.02 USDC",
    from: "server",
    to: "client",
    label: "402 Payment Required",
    highlight: "warning",
    response: `HTTP/1.1 402 Payment Required

// Client now creates a USDC payment on Base Sepolia
// and resends with both headers`,
  },
  {
    id: "b8",
    title: "8. Pay + Retry",
    subtitle: "Client sends SIWX + payment signature ($0.02 USDC on Base Sepolia)",
    from: "client",
    to: "server",
    label: "GET + SIWX + PAYMENT",
    request: `GET /api/random HTTP/1.1
Host: localhost:3000
SIGN-IN-WITH-X: <signed Solana identity>
PAYMENT-SIGNATURE: <$0.02 USDC on Base Sepolia>`,
  },
  {
    id: "b9",
    title: "9. Verify Payment",
    subtitle: "Server sends payment to x402 facilitator for verification",
    from: "server",
    to: "facilitator",
    label: "Verify payment",
  },
  {
    id: "b10",
    title: "10. Payment Valid",
    subtitle: "Facilitator confirms $0.02 USDC payment is valid",
    from: "facilitator",
    to: "server",
    label: "Payment valid",
    highlight: "success",
  },
  {
    id: "b11",
    title: "11. Paid Access Granted",
    subtitle: "Server serves the endpoint after successful payment",
    from: "server",
    to: "client",
    label: "200 OK",
    highlight: "success",
    response: `HTTP/1.1 200 OK
Content-Type: application/json

{ "number": 3 }`,
    note: "$0.02 USDC paid on Base Sepolia. The SIWX identity was Solana, the payment was EVM \u2014 fully cross-chain.",
  },
];

// ─── Actor Column Positions ───

const ACTORS: { id: Actor; label: string; sublabel: string }[] = [
  { id: "client", label: "Client", sublabel: "Wallet" },
  { id: "server", label: "Server", sublabel: "x402 Middleware" },
  { id: "solana", label: "Solana", sublabel: "Mainnet RPC" },
  { id: "facilitator", label: "Facilitator", sublabel: "x402.org" },
];

function getActorIndex(actor: Actor): number {
  return ACTORS.findIndex((a) => a.id === actor);
}

// ─── Components ───

function ActorColumns({ activeActors }: { activeActors: Set<Actor> }) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-8">
      {ACTORS.map((actor) => (
        <motion.div
          key={actor.id}
          className="text-center"
          animate={{
            opacity: activeActors.has(actor.id) ? 1 : 0.3,
          }}
          transition={{ duration: 0.3 }}
        >
          <div
            className="w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center text-lg font-bold"
            style={{
              backgroundColor: activeActors.has(actor.id)
                ? "#333"
                : "#1a1a1a",
              border: `2px solid ${activeActors.has(actor.id) ? "#555" : "#282828"}`,
              color: activeActors.has(actor.id) ? "#fafafa" : "#555",
            }}
          >
            {actor.id === "client" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            )}
            {actor.id === "server" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            )}
            {actor.id === "solana" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            )}
            {actor.id === "facilitator" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            )}
          </div>
          <div className="text-xs font-bold" style={{ color: "#fafafa" }}>
            {actor.label}
          </div>
          <div className="text-xs" style={{ color: "#666" }}>
            {actor.sublabel}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function Arrow({ from, to, label, highlight }: { from: Actor; to: Actor; label: string; highlight?: string }) {
  const fromIdx = getActorIndex(from);
  const toIdx = getActorIndex(to);
  const isSelf = from === to;

  const highlightColor =
    highlight === "success" ? "#4ade80" :
    highlight === "warning" ? "#fbbf24" :
    highlight === "error"   ? "#f87171" :
    highlight === "info"    ? "#818cf8" :
    "#666";

  if (isSelf) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="grid grid-cols-4 gap-4 my-3"
      >
        <div
          className="flex items-center justify-center"
          style={{ gridColumn: `${fromIdx + 1} / ${fromIdx + 2}` }}
        >
          <div
            className="px-3 py-1.5 rounded-full text-xs font-mono"
            style={{
              backgroundColor: `${highlightColor}15`,
              border: `1px solid ${highlightColor}40`,
              color: highlightColor,
            }}
          >
            {label}
          </div>
        </div>
      </motion.div>
    );
  }

  const leftIdx = Math.min(fromIdx, toIdx);
  const rightIdx = Math.max(fromIdx, toIdx);
  const goingRight = toIdx > fromIdx;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="grid grid-cols-4 gap-4 my-3"
    >
      <div
        className="flex items-center"
        style={{
          gridColumn: `${leftIdx + 1} / ${rightIdx + 2}`,
        }}
      >
        <div className="w-full flex items-center">
          {!goingRight && (
            <svg width="10" height="10" viewBox="0 0 10 10" className="flex-shrink-0">
              <polygon points="0,5 10,0 10,10" fill={highlightColor} />
            </svg>
          )}
          <div className="flex-1 relative">
            <div className="h-px w-full" style={{ backgroundColor: highlightColor }} />
            <motion.div
              className="absolute top-0 h-px"
              style={{ backgroundColor: highlightColor }}
              initial={{ width: 0, [goingRight ? "left" : "right"]: 0 }}
              animate={{ width: "100%" }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
            <div
              className="absolute -top-4 left-1/2 -translate-x-1/2 text-xs font-mono whitespace-nowrap px-2 py-0.5 rounded"
              style={{
                color: highlightColor,
                backgroundColor: "#111",
              }}
            >
              {label}
            </div>
          </div>
          {goingRight && (
            <svg width="10" height="10" viewBox="0 0 10 10" className="flex-shrink-0">
              <polygon points="10,5 0,0 0,10" fill={highlightColor} />
            </svg>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function CodeBlock({ code, variant }: { code: string; variant?: "request" | "response" }) {
  const borderColor = variant === "request" ? "#818cf830" : variant === "response" ? "#4ade8030" : "#33333380";
  const labelColor = variant === "request" ? "#818cf8" : "#4ade80";
  const label = variant === "request" ? "REQUEST" : "RESPONSE";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid ${borderColor}`, backgroundColor: "#0d0d0d" }}
    >
      {variant && (
        <div className="px-4 py-1.5 text-xs font-mono tracking-wider" style={{ color: labelColor, backgroundColor: "#151515" }}>
          {label}
        </div>
      )}
      <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto" style={{ color: "#b0b0b0" }}>
        {code}
      </pre>
    </motion.div>
  );
}

function StepDetail({ step }: { step: Step }) {
  return (
    <motion.div
      key={step.id}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-4"
    >
      <div>
        <h3 className="text-xl font-bold" style={{ color: "#fafafa" }}>
          {step.title}
        </h3>
        <p className="text-sm mt-1" style={{ color: "#888" }}>
          {step.subtitle}
        </p>
      </div>

      {step.request && <CodeBlock code={step.request} variant="request" />}
      {step.response && <CodeBlock code={step.response} variant="response" />}

      {step.note && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-xs leading-relaxed px-4 py-3 rounded-lg"
          style={{ color: "#a0a0a0", backgroundColor: "#1a1a1a", border: "1px solid #282828" }}
        >
          {step.note}
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Main Page ───

type Path = "a" | "b";

export default function DemoPage() {
  const [path, setPath] = useState<Path>("a");
  const [stepIdx, setStepIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const steps = path === "a" ? PATH_A_STEPS : PATH_B_STEPS;
  const currentStep = steps[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;

  const next = useCallback(() => {
    if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
  }, [stepIdx, steps.length]);

  const prev = useCallback(() => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }, [stepIdx]);

  const switchPath = useCallback(
    (p: Path) => {
      if (p !== path) {
        setPath(p);
        setStepIdx(0);
        setIsPlaying(false);
      }
    },
    [path]
  );

  // Autoplay
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (isLast) setStepIdx(0);
    setIsPlaying(true);
  }, [isPlaying, isLast]);

  // Autoplay timer
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setStepIdx((i) => {
        const max = (path === "a" ? PATH_A_STEPS : PATH_B_STEPS).length - 1;
        if (i >= max) {
          setIsPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [isPlaying, path]);

  // Keyboard navigation
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setStepIdx((i) => {
          const max = (pathRef.current === "a" ? PATH_A_STEPS : PATH_B_STEPS).length - 1;
          return Math.min(i + 1, max);
        });
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStepIdx((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Active actors for this step
  const activeActors = new Set<Actor>();
  activeActors.add(currentStep.from);
  activeActors.add(currentStep.to);

  return (
    <main
      data-path={path}
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#111111", color: "#fafafa" }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid #222" }}
      >
        <div>
          <h1 className="font-jersey text-2xl tracking-tight">
            SIWX Token Gate
          </h1>
          <p className="text-xs" style={{ color: "#666" }}>
            Interactive Flow Demo
          </p>
        </div>

        {/* Path toggle */}
        <div
          className="flex rounded-lg overflow-hidden text-xs font-mono"
          style={{ border: "1px solid #333" }}
        >
          <button
            onClick={() => switchPath("a")}
            className="px-4 py-2 transition-colors"
            style={{
              backgroundColor: path === "a" ? "#4ade8020" : "transparent",
              color: path === "a" ? "#4ade80" : "#666",
            }}
          >
            Path A: Token Holder
          </button>
          <button
            onClick={() => switchPath("b")}
            className="px-4 py-2 transition-colors"
            style={{
              backgroundColor: path === "b" ? "#fbbf2420" : "transparent",
              color: path === "b" ? "#fbbf24" : "#666",
              borderLeft: "1px solid #333",
            }}
          >
            Path B: Payment
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left: Sequence diagram */}
        <div className="flex-1 p-6 lg:p-8 flex flex-col">
          {/* Actor headers */}
          <ActorColumns activeActors={activeActors} />

          {/* Rendered arrows for all steps up to current */}
          <div className="flex-1 flex flex-col gap-1">
            {steps.slice(0, stepIdx + 1).map((step) => (
              <Arrow
                key={step.id}
                from={step.from}
                to={step.to}
                label={step.label}
                highlight={step.highlight}
              />
            ))}
          </div>

          {/* Progress bar */}
          <div className="mt-8">
            <div className="flex gap-1">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { setStepIdx(i); setIsPlaying(false); }}
                  className="flex-1 h-1.5 rounded-full transition-colors"
                  style={{
                    backgroundColor:
                      i <= stepIdx
                        ? path === "a"
                          ? "#4ade80"
                          : "#fbbf24"
                        : "#282828",
                  }}
                />
              ))}
            </div>
            <div
              className="flex justify-between mt-2 text-xs font-mono"
              style={{ color: "#555" }}
            >
              <span>
                Step {stepIdx + 1} / {steps.length}
              </span>
              <span>
                {path === "a" ? "Free Access" : "Paid Access"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Step detail */}
        <div
          className="lg:w-[440px] p-6 lg:p-8 flex flex-col"
          style={{ borderLeft: "1px solid #222" }}
        >
          <div className="flex-1">
            <AnimatePresence mode="wait">
              <StepDetail step={currentStep} key={currentStep.id} />
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3 mt-8">
            <button
              onClick={prev}
              disabled={isFirst}
              className="px-4 py-2 rounded-lg text-sm font-mono transition-colors"
              style={{
                backgroundColor: isFirst ? "#1a1a1a" : "#282828",
                color: isFirst ? "#444" : "#aaa",
                border: "1px solid #333",
                cursor: isFirst ? "default" : "pointer",
              }}
            >
              Back
            </button>
            <button
              onClick={togglePlay}
              className="px-4 py-2 rounded-lg text-sm font-mono transition-colors"
              style={{
                backgroundColor: "#1a1a1a",
                color: isPlaying ? "#fbbf24" : "#888",
                border: "1px solid #333",
              }}
            >
              {isPlaying ? "Pause" : "Auto"}
            </button>
            <button
              onClick={next}
              disabled={isLast}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-mono font-bold transition-colors"
              style={{
                backgroundColor: isLast
                  ? "#1a1a1a"
                  : path === "a"
                    ? "#4ade8020"
                    : "#fbbf2420",
                color: isLast
                  ? "#444"
                  : path === "a"
                    ? "#4ade80"
                    : "#fbbf24",
                border: `1px solid ${
                  isLast
                    ? "#333"
                    : path === "a"
                      ? "#4ade8040"
                      : "#fbbf2440"
                }`,
                cursor: isLast ? "default" : "pointer",
              }}
            >
              {isLast ? "Done" : "Next Step"}
            </button>
          </div>

          <p className="text-xs mt-3 text-center" style={{ color: "#444" }}>
            Use arrow keys or spacebar to navigate
          </p>
        </div>
      </div>
    </main>
  );
}
