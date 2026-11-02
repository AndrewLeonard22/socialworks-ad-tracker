// Builds artifact/dist/ad-tracker.html: the Next.js app's own pages bundled
// into one self-contained page (claude.ai artifact). Run after `npm run build`
// so the compiled CSS (Tailwind + swa.css + globals.css + tracker.css) exists.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

execFileSync("npx", [
  "--yes", "esbuild@0.25.0", join(here, "entry.tsx"),
  "--bundle", "--minify", "--format=iife", "--jsx=automatic", "--target=es2020",
  `--alias:next/link=${join(here, "shims/next-link.tsx")}`,
  `--alias:next/navigation=${join(here, "shims/next-navigation.ts")}`,
  `--alias:@/lib/live=${join(here, "shims/live.ts")}`,
  "--define:process.env.NODE_ENV=\"production\"",
  "--log-level=warning",
  `--outfile=${join(dist, "app.js")}`,
], { cwd: root, stdio: "inherit" });

/* the compiled stylesheets from the Next build, in the order Next links them
   (globals.css before tracker.css matters: both carry unlayered rules) */
const page = readFileSync(join(root, ".next/server/app/index.html"), "utf8");
const cssFiles = [...page.matchAll(/<link rel="stylesheet" href="\/_next\/(static\/chunks\/[^"]+\.css)"/g)].map((m) => m[1]);
if (!cssFiles.length) throw new Error("no stylesheets found; run `npm run build` first");
let css = cssFiles.map((f) => readFileSync(join(root, ".next", f), "utf8")).join("\n");
/* next/font self-hosts Urbanist; inline those exact woff2 files so the artifact
   renders the same glyphs with no external requests */
/* next/font repeats one variable file per weight; keep one face per file and
   give it the whole 200-600 axis (same rendering, a third of the bytes) */
const seen = new Set();
css = css.replace(/@font-face\{font-family:Urbanist;[^}]*\}/g, (block) => {
  const file = block.match(/url\(\.\.\/media\/([^)]+)\)/)?.[1];
  if (!file || seen.has(file)) return "";
  seen.add(file);
  return block.replace(/font-weight:\d+/, "font-weight:200 600");
});
css = css.replace(/url\(\.\.\/media\/([^)]+\.woff2)\)/g, (_, f) =>
  `url(data:font/woff2;base64,${readFileSync(join(root, ".next/static/media", f)).toString("base64")})`
);
if (css.includes("../media/")) throw new Error("unresolved font url left in CSS");
/* the layout puts these on <html>/<body>; the artifact skeleton owns those tags */
css += `\n:root{--font-urbanist:"Urbanist","Urbanist Fallback"}html,body,#root{height:100%}body{background:#000}`;

const logo = "data:image/svg+xml;base64," + readFileSync(join(root, "public/logo.svg")).toString("base64");
let js = readFileSync(join(dist, "app.js"), "utf8").replaceAll('"/logo.svg"', JSON.stringify(logo));
/* keep inline script safe from an early </script> */
js = js.replaceAll("</script", "<\\/script");

const html = `<title>SocialWorks Ad Tracker</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
writeFileSync(join(dist, "ad-tracker.html"), html);
console.log("css files:", cssFiles.length, "html bytes:", html.length);
