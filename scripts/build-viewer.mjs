// Bundle the viewer page (PLAN section 8: plain TypeScript bundled with esbuild into one JS file,
// plus CSS) into dist/viewer/static, next to the compiled server that serves it.
import { build } from "esbuild";
import process from "node:process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "viewer", "static");
const out = process.argv[2] ?? join(root, "dist", "viewer", "static");

mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(src, "app.ts")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
for (const file of ["index.html", "styles.css"]) {
  copyFileSync(join(src, file), join(out, file));
}
process.stdout.write(`viewer bundled into ${out}\n`);
