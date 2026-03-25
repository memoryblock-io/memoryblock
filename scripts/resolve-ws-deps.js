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

const root = process.cwd();
const packagesDir = path.join(root, "packages");

// Build name → version map
const versionMap = {};

function collectVersions(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.existsSync(path.join(full, "package.json"))) {
      const pkg = require(path.join(full, "package.json"));
      versionMap[pkg.name] = pkg.version;
    } else if (fs.statSync(full).isDirectory()) {
      collectVersions(full);
    }
  }
}

collectVersions(packagesDir);

// Rewrite workspace deps
function rewriteDeps(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (fs.existsSync(path.join(full, "package.json"))) {
      const pkgPath = path.join(full, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

      ["dependencies", "devDependencies", "peerDependencies"].forEach(field => {
        if (!pkg[field]) return;

        for (const dep in pkg[field]) {
          if (pkg[field][dep].startsWith("workspace:")) {
            pkg[field][dep] = `^${versionMap[dep]}`;
          }
        }
      });

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    } else if (fs.statSync(full).isDirectory()) {
      rewriteDeps(full);
    }
  }
}

rewriteDeps(packagesDir);

console.log("Workspace dependencies resolved.");