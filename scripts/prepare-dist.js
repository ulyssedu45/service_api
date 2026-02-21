/**
 * prepare-dist.js
 *
 * Copies package.json (without scripts & devDependencies) and README.md
 * into dist/ so that `npm publish ./dist` produces a clean package
 * with files at the root instead of nested under dist/.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

// ── package.json (strip fields that are irrelevant for consumers) ────────────
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
delete pkg.scripts;
delete pkg.devDependencies;
delete pkg.files; // everything in dist/ should be included
fs.writeFileSync(path.join(dist, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

// ── README.md ────────────────────────────────────────────────────────────────
const readme = path.join(root, "README.md");
if (fs.existsSync(readme)) {
  fs.copyFileSync(readme, path.join(dist, "README.md"));
}

console.log("✔ dist/package.json and dist/README.md ready for publishing");
