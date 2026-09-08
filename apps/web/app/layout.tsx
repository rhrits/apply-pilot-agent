import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import "./features.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ap.coderscookies.com"),
  title: {
    default: "ApplyPilot | AI Job Application Assistant",
    template: "%s | ApplyPilot",
  },
  description: "ApplyPilot is an open source AI job application assistant that builds one verified profile, suggests grounded answers, and helps you complete repetitive forms faster without inventing your experience.",
  applicationName: "ApplyPilot",
  authors: [{ name: "Hritik" }],
  creator: "Hritik",
  keywords: ["auto job apply agent", "job application assistant", "AI job application assistant", "resume autofill", "job search productivity"],
  alternates: { canonical: "https://ap.coderscookies.com" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://ap.coderscookies.com",
    siteName: "ApplyPilot",
    title: "ApplyPilot | AI Job Application Assistant",
    description: "Build one verified profile, answer repetitive application questions, and stay in control of every submission.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "ApplyPilot open source AI job application assistant" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ApplyPilot | AI Job Application Assistant",
    description: "An open source job application assistant grounded in your real experience.",
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  icons: { icon: "/applypilot-icon.svg", shortcut: "/icons/128.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<Script type="module" strategy="afterInteractive" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"f345f612cc04f9186e7264662ee1efb"}' /></body></html>;
}
