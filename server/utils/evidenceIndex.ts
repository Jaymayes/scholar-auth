import { readdir, readFile, stat } from "fs/promises";
import { createHash } from "crypto";
import { join, relative } from "path";

export interface EvidenceFile {
  filename: string;
  path: string;
  url: string;
  title: string;
  purpose: string;
  timestamp: string;
  sha256: string;
  sizeBytes: number;
}

export interface EvidenceIndex {
  generated: string;
  appName: string;
  appBaseUrl: string;
  files: EvidenceFile[];
}

const EVIDENCE_ROOT = join(process.cwd(), "evidence_root");

async function computeSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function extractMetadata(filePath: string): Promise<{
  title: string;
  purpose: string;
}> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 20);
    
    let title = "";
    let purpose = "";
    
    for (const line of lines) {
      if (line.startsWith("# ")) {
        title = line.substring(2).trim();
        break;
      }
    }
    
    const purposeLine = lines.find(l => 
      l.includes("Purpose:") || 
      l.includes("Document Date:") ||
      l.includes("Status:")
    );
    
    if (purposeLine) {
      purpose = purposeLine.trim();
    }
    
    if (!title) {
      const filename = filePath.split("/").pop() || "";
      title = filename.replace(/\.md$/, "").replace(/_/g, " ");
    }
    
    if (!purpose) {
      purpose = "Evidence document for scholar_auth";
    }
    
    return { title, purpose };
  } catch {
    const filename = filePath.split("/").pop() || "";
    return {
      title: filename.replace(/\.md$/, "").replace(/_/g, " "),
      purpose: "Evidence document for scholar_auth"
    };
  }
}

async function scanEvidenceDirectory(dir: string = EVIDENCE_ROOT): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await scanEvidenceDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }
  
  return files;
}

export async function generateEvidenceIndex(): Promise<EvidenceIndex> {
  const appBaseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://scholar-auth-jamarrlmayes.replit.app";
  
  const filePaths = await scanEvidenceDirectory();
  const files: EvidenceFile[] = [];
  
  for (const filePath of filePaths) {
    try {
      const stats = await stat(filePath);
      const relativePath = relative(EVIDENCE_ROOT, filePath);
      const sha256 = await computeSha256(filePath);
      const metadata = await extractMetadata(filePath);
      
      files.push({
        filename: relativePath.split("/").pop() || "",
        path: relativePath,
        url: `${appBaseUrl}/evidence/${relativePath}`,
        title: metadata.title,
        purpose: metadata.purpose,
        timestamp: stats.mtime.toISOString(),
        sha256,
        sizeBytes: stats.size
      });
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  files.sort((a, b) => a.path.localeCompare(b.path));
  
  return {
    generated: new Date().toISOString(),
    appName: "scholar_auth",
    appBaseUrl,
    files
  };
}
