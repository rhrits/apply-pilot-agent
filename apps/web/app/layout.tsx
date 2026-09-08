import type { Metadata } from "next";
import "./globals.css";
import "./features.css";

export const metadata: Metadata = {
  title: "ApplyPilot — Your job application copilot",
  description: "Build your profile once. Apply with confidence everywhere.",
  icons: { icon: "/applypilot-icon.svg", shortcut: "/icons/128.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
