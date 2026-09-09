import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import "./features.css";
import "./theme-overrides.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ap.coderscookies.com"),
  title: {
    default: "UplyFox | AI Job Application Assistant",
    template: "%s | UplyFox",
  },
  description: "UplyFox is an AI job application assistant that builds one verified profile, suggests grounded answers, and helps you complete repetitive forms faster without inventing your experience.",
  applicationName: "UplyFox",
  authors: [{ name: "Hritik" }],
  creator: "Hritik",
  keywords: ["auto job apply agent", "job application assistant", "AI job application assistant", "resume autofill", "job search productivity"],
  alternates: { canonical: "https://ap.coderscookies.com" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://ap.coderscookies.com",
    siteName: "UplyFox",
    title: "UplyFox | AI Job Application Assistant",
    description: "Build one verified profile, answer repetitive application questions, and stay in control of every submission.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "UplyFox AI job application assistant" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "UplyFox | AI Job Application Assistant",
    description: "A job application assistant grounded in your real experience.",
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  icons: { icon: "/uplyfox-pixel-crimson-logo.svg", shortcut: "/uplyfox-pixel-crimson-logo.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<Script type="module" strategy="afterInteractive" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"f345f612cc04c9186e7264662ee1efb"}' /></body></html>;
}
