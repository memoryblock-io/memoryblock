/**
 * --------------------------------------------------------------------
 * memoryblock : Deploy isolated, multi-agent AI assistants
 *
 * @package     memoryblock
 * @website     https://memoryblock.io
 * @repository  https://github.com/memoryblock-io/memoryblock
 * @license     MIT
 * @copyright   Copyright (c) 2025-present memoryblock.io
 *
 * [memoryblock-source]
 * --------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const newVersion = process.argv[2];

if (!newVersion) {
  console.error("Usage: node scripts/bump-version.js <new-version>");
  process.exit(1);
}

const root = process.cwd();
const packagesDir = path.join(root, "packages");

function updateVersion(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log(`Updated: ${pkg.name} → ${newVersion}`);
}

// 1️⃣ Update root
updateVersion(path.join(root, "package.json"));

// 2️⃣ Recursively update all packages
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (fs.existsSync(path.join(full, "package.json"))) {
      updateVersion(path.join(full, "package.json"));
    } else if (fs.statSync(full).isDirectory()) {
      walk(full);
    }
  }
}

walk(packagesDir);

console.log("Version bump complete.");