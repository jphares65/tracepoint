import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SupportModeBanner from "@/components/SupportModeBanner";

const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "TracePoint",
  description: "Firearms compliance, qualifications, inspections, and accountability platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full w-full antialiased`}
    >
      <body className="min-h-screen w-full overflow-x-hidden bg-slate-950 text-slate-100">
        <SupportModeBanner />
        {children}
      </body>
    </html>
  );
}

