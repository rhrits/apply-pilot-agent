"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview", glyph: "⌂" },
  { href: "/profile", label: "Profile & resume", glyph: "✦" },
  { href: "/tracker", label: "Job tracker", glyph: "⌁" },
  { href: "/answer-library", label: "Answer library", glyph: "✎" },
  { href: "/settings", label: "Settings", glyph: "⚙" },
];

/** Shared enchanted-forest navigation for every authenticated workspace screen. */
export function WorkspaceSidebar() {
  const pathname = usePathname();
  return <aside className="sidebar forest-sidebar">
    <Link className="logo forest-logo" href="/dashboard">
      <span className="forest-logo-box"><img src="/uplyfox-pixel-crimson-animated-logo.svg" width={38} height={38} alt="" /></span>
      <span>Uply<strong>Fox</strong><small>Career grove</small></span>
    </Link>
    <nav className="nav forest-nav" aria-label="Workspace navigation">
      {links.map((link) => <Link className={pathname === link.href || pathname.startsWith(`${link.href}/`) ? "active" : ""} href={link.href} key={link.href}>
        <span aria-hidden="true">{link.glyph}</span>{link.label}
      </Link>)}
    </nav>
    <div className="sidebar-bottom forest-note">
      <span className="forest-spark" aria-hidden="true">✦</span>
      <strong>Your application grove</strong>
      <p>Each verified fact helps your fox complete the next form more accurately.</p>
    </div>
  </aside>;
}
