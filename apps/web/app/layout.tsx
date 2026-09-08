import type { Metadata } from "next";
import "./globals.css";
import "./features.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ap.coderscookies.com"),
  title: {
    default: "ApplyPilot — Auto Job Apply Agent",
    template: "%s | ApplyPilot",
  },
  description: "ApplyPilot is an auto job apply agent that builds a verified profile, drafts grounded application answers, and helps you move through job applications faster without inventing your experience.",
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
    title: "ApplyPilot — Auto Job Apply Agent",
    description: "Build a verified profile, get grounded application answers, and move through repetitive job applications with you in control.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "ApplyPilot auto job apply agent" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ApplyPilot — Auto Job Apply Agent",
    description: "A job application agent grounded in your real experience.",
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  icons: { icon: "/applypilot-icon.svg", shortcut: "/icons/128.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
