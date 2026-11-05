/**
 * Stamp a unique build id into dist/ so every deploy gets a new SW cache
 * and busted asset URLs. Users pick up updates without reinstalling.
 *
 * Usage: node scripts/stamp-build.mjs
 * Expects dist/ already copied (index.html, sw.js, src/, …).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
const id = (sha ? sha.slice(0, 10) : String(Date.now())).replace(
  /[^a-zA-Z0-9._-]/g,
  ""
);

const STAMP_EXTS = new Set([".html", ".js", ".css", ".webmanifest", ".json"]);

function stampText(text) {
  return text
    .replace(/movie-v[\w.-]+/g, `movie-v${id}`)
    .replace(/([?&]v=)[\w.-]+/g, `$1${id}`)
    .replace(/__BUILD_ID__/g, id);
}

function stampFile(abs) {
  let text = fs.readFileSync(abs, "utf8");
  const next = stampText(text);
  if (next === text) return false;
  fs.writeFileSync(abs, next);
  return true;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (STAMP_EXTS.has(path.extname(name).toLowerCase())) out.push(abs);
  }
  return out;
}

if (!fs.existsSync(dist)) {
  console.error("[stamp-build] dist/ not found — run the copy step first");
  process.exit(1);
}

const files = walk(dist);
let stamped = 0;
for (const abs of files) {
  if (stampFile(abs)) {
    stamped += 1;
    console.log(`[stamp-build] ${path.relative(dist, abs)} → ${id}`);
  }
}

fs.writeFileSync(
  path.join(dist, "version.json"),
  JSON.stringify({ build: id, stampedAt: new Date().toISOString() }, null, 2) +
    "\n"
);
console.log(
  `[stamp-build] version.json → ${id} (${stamped} file${stamped === 1 ? "" : "s"} rewritten)`
);
