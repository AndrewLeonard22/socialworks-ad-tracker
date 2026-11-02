import type { AnchorHTMLAttributes } from "react";

/* Artifact build only: claude.ai artifacts route on a plain #name hash */
export default function Link({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href === "/" ? "#dashboard" : `#${href.replace(/^\//, "")}`} {...rest} />;
}
