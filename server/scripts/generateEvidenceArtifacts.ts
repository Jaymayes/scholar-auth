#!/usr/bin/env tsx
import { writeManifestToFile, writeIndexHtmlToFile } from "../utils/generateManifest";

async function main() {
  console.log("📂 Generating evidence artifacts...\n");
  
  try {
    await writeManifestToFile();
    await writeIndexHtmlToFile();
    
    console.log("\n✅ All evidence artifacts generated successfully");
    console.log("\nFiles created:");
    console.log("  - evidence_root/manifest.json");
    console.log("  - evidence_root/index.html");
    console.log("\nAccess URLs:");
    console.log("  - https://scholar-auth-jamarrlmayes.replit.app/evidence/manifest.json");
    console.log("  - https://scholar-auth-jamarrlmayes.replit.app/evidence/index.html");
    console.log("  - https://scholar-auth-jamarrlmayes.replit.app/evidence/");
  } catch (error) {
    console.error("❌ Error generating artifacts:", error);
    process.exit(1);
  }
}

main();
