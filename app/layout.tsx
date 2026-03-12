import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SIWX Allowlist | x402 VIP Free Access Example",
  description:
    "A payment-gated API using x402 and SIWX where allowlisted wallets get free access. The simplest SIWX gate pattern.",
  openGraph: {
    title: "SIWX Allowlist | x402 VIP Free Access Example",
    description:
      "A payment-gated API using x402 and SIWX where allowlisted wallets get free access.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SIWX Allowlist | x402 VIP Free Access Example",
    description:
      "A payment-gated API using x402 and SIWX where allowlisted wallets get free access.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Jersey+25&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={geistMono.variable}>
        {children}
      </body>
    </html>
  );
}
