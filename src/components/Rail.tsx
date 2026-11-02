"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { V2Icon } from "./v2/icons";

const NAV = [
  { href: "/", label: "Dashboard", icon: "grid" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/clients", label: "Clients", icon: "user" },
];

/* proto .rail: logo on top, round tabs that grow into a labelled pill on hover */
export function Rail() {
  const path = usePathname();
  return (
    <nav className="rail" aria-label="Main">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rail-logo" src="/logo.svg" alt="SocialWorks" width={40} height={28} />
      <div className="rail-nav">
        {NAV.map(({ href, label, icon }) => {
          const act = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`rbtn${act ? " active" : ""}`}
              aria-current={act ? "page" : undefined}
            >
              <V2Icon name={icon} />
              <span className="tip">{label}</span>
            </Link>
          );
        })}
      </div>
      <div className="rail-bottom">
        <div className="avatar at-avatar" title="SocialWorks">
          SW
        </div>
      </div>
    </nav>
  );
}
