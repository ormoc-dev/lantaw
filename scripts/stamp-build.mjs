/**
 * Stamp a unique build id into dist/ so every deploy gets a new SW cache
 * and busted asset URLs. Users pick up updates without reinstalling.
 *
 * Usage: node scripts/stamp-build.mjs
 * Expects dist/index.html and dist/sw.js already copied.
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

function stampFile(rel) {
  const file = path.join(dist, rel);
  if (!fs.existsSync(file)) {
    console.warn(`[stamp-build] skip missing ${rel}`);
    return;
  }
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/movie-v[\w.-]+/g, `movie-v${id}`);
  text = text.replace(/([?&]v=)[\w.-]+/g, `$1${id}`);
  // Optional marker for debugging / client checks
  text = text.replace(/__BUILD_ID__/g, id);
  fs.writeFileSync(file, text);
  console.log(`[stamp-build] ${rel} → ${id}`);
}

if (!fs.existsSync(dist)) {
  console.error("[stamp-build] dist/ not found — run the copy step first");
  process.exit(1);
}

stampFile("index.html");
stampFile("sw.js");

fs.writeFileSync(
  path.join(dist, "version.json"),
  JSON.stringify({ build: id, stampedAt: new Date().toISOString() }, null, 2) +
    "\n"
);
console.log(`[stamp-build] version.json → ${id}`);
