/**
 * Patch openid-client@5.x exports map for Node 20 ESM compatibility
 *
 * Problem: openid-client@5.7.1 ships lib/passport_strategy.js but does not
 * declare "./passport" in its package.json exports field. Node 20's strict
 * ESM resolver throws ERR_PACKAGE_PATH_NOT_EXPORTED when the bundled app
 * does: import { Strategy } from "openid-client/passport"
 *
 * Solution: Add the missing "./passport" entry to the exports map.
 */
const fs = require("fs");
const path = require("path");

const pkgPath = path.join("/app", "node_modules", "openid-client", "package.json");

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  if (pkg.exports && pkg.exports["./passport"] === undefined) {
    // Restructure exports: wrap existing root export under "." key
    pkg.exports = {
      ".": pkg.exports,
      "./passport": "./lib/passport_strategy.js"
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("OK: Patched openid-client exports - added ./passport subpath");
  } else if (pkg.exports && pkg.exports["./passport"] !== undefined) {
    console.log("SKIP: openid-client already has ./passport export");
  } else {
    console.log("SKIP: openid-client has no exports field (CJS fallback will work)");
  }
} catch (err) {
  console.error("WARN: Could not patch openid-client:", err.message);
  process.exit(1);
}
