import { readdir, readFile, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { join, relative, extname } from "path";

interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
  contentType: string;
  lastModified: string;
}

interface Manifest {
  generated: string;
  appName: string;
  appBaseUrl: string;
  totalFiles: number;
  entries: ManifestEntry[];
}

const EVIDENCE_ROOT = join(process.cwd(), "evidence_root");

function getContentType(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

async function computeSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function scanDirectory(dir: string = EVIDENCE_ROOT): Promise<string[]> {
  const files: string[] = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }
  
  return files;
}

export async function generateManifest(): Promise<Manifest> {
  const appBaseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://scholar-auth-jamarrlmayes.replit.app";
  
  const filePaths = await scanDirectory();
  const entries: ManifestEntry[] = [];
  
  for (const filePath of filePaths) {
    try {
      const stats = await stat(filePath);
      const relativePath = relative(EVIDENCE_ROOT, filePath);
      const sha256 = await computeSha256(filePath);
      const contentType = getContentType(filePath);
      
      entries.push({
        path: relativePath,
        sha256,
        size: stats.size,
        contentType,
        lastModified: stats.mtime.toISOString()
      });
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }
  
  entries.sort((a, b) => a.path.localeCompare(b.path));
  
  return {
    generated: new Date().toISOString(),
    appName: "scholar_auth",
    appBaseUrl,
    totalFiles: entries.length,
    entries
  };
}

export async function writeManifestToFile(): Promise<void> {
  const manifest = await generateManifest();
  const manifestPath = join(EVIDENCE_ROOT, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`✅ Manifest written to ${manifestPath} (${manifest.totalFiles} files)`);
}

export async function generateIndexHtml(manifest: Manifest): Promise<string> {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Evidence Index - scholar_auth</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2563eb;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .meta {
      color: #666;
      margin-bottom: 30px;
      padding: 15px;
      background: #f8fafc;
      border-left: 4px solid #2563eb;
      border-radius: 4px;
    }
    .meta strong { color: #333; }
    .search {
      margin-bottom: 20px;
      position: sticky;
      top: 0;
      background: white;
      padding: 15px 0;
      z-index: 10;
      border-bottom: 2px solid #e5e7eb;
    }
    .search input {
      width: 100%;
      padding: 12px 16px;
      font-size: 16px;
      border: 2px solid #e5e7eb;
      border-radius: 6px;
      transition: border-color 0.2s;
    }
    .search input:focus {
      outline: none;
      border-color: #2563eb;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th {
      background: #f8fafc;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #1f2937;
      border-bottom: 2px solid #e5e7eb;
      position: sticky;
      top: 73px;
      z-index: 5;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    tr:hover {
      background: #f8fafc;
    }
    a {
      color: #2563eb;
      text-decoration: none;
      font-weight: 500;
    }
    a:hover {
      text-decoration: underline;
    }
    .sha256 {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #666;
      word-break: break-all;
    }
    .size {
      color: #666;
      white-space: nowrap;
    }
    .date {
      color: #666;
      font-size: 14px;
      white-space: nowrap;
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      background: #dbeafe;
      color: #1e40af;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .no-results {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 18px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📂 Evidence Index - scholar_auth</h1>
    <div class="meta">
      <strong>Application:</strong> scholar_auth<br>
      <strong>Base URL:</strong> <a href="${manifest.appBaseUrl}" target="_blank">${manifest.appBaseUrl}</a><br>
      <strong>Total Files:</strong> ${manifest.totalFiles}<br>
      <strong>Generated:</strong> ${new Date(manifest.generated).toLocaleString()}<br>
      <strong>Purpose:</strong> CEO-mandated compliance evidence for Gate C decision-making
    </div>
    
    <div class="search">
      <input 
        type="text" 
        id="searchInput" 
        placeholder="Search by filename, path, or SHA-256 checksum..."
        autocomplete="off"
      >
    </div>
    
    <table id="evidenceTable">
      <thead>
        <tr>
          <th style="width: 35%;">File Path</th>
          <th style="width: 10%;">Size</th>
          <th style="width: 15%;">Content Type</th>
          <th style="width: 25%;">SHA-256 Checksum</th>
          <th style="width: 15%;">Last Modified</th>
        </tr>
      </thead>
      <tbody>
        ${manifest.entries.map(entry => `
        <tr class="evidence-row" data-path="${entry.path.toLowerCase()}" data-sha="${entry.sha256}">
          <td>
            <a href="${manifest.appBaseUrl}/evidence/${entry.path}" target="_blank">
              ${entry.path}
            </a>
          </td>
          <td class="size">${formatBytes(entry.size)}</td>
          <td><span class="badge">${entry.contentType.split(';')[0]}</span></td>
          <td class="sha256" title="${entry.sha256}">${entry.sha256.substring(0, 16)}...</td>
          <td class="date">${new Date(entry.lastModified).toLocaleString()}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    
    <div id="noResults" class="no-results" style="display: none;">
      No files match your search criteria
    </div>
  </div>
  
  <script>
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    const searchInput = document.getElementById('searchInput');
    const table = document.getElementById('evidenceTable');
    const noResults = document.getElementById('noResults');
    const rows = document.querySelectorAll('.evidence-row');
    
    searchInput.addEventListener('input', function(e) {
      const searchTerm = e.target.value.toLowerCase();
      let visibleCount = 0;
      
      rows.forEach(row => {
        const path = row.getAttribute('data-path');
        const sha = row.getAttribute('data-sha');
        const matches = path.includes(searchTerm) || sha.includes(searchTerm);
        
        row.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
      });
      
      table.style.display = visibleCount > 0 ? '' : 'none';
      noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    });
    
    // Log access for monitoring
    console.log('Evidence index loaded:', {
      totalFiles: ${manifest.totalFiles},
      generated: '${manifest.generated}',
      appName: '${manifest.appName}'
    });
  </script>
</body>
</html>`;
}

export async function writeIndexHtmlToFile(): Promise<void> {
  const manifest = await generateManifest();
  const html = await generateIndexHtml(manifest);
  const indexPath = join(EVIDENCE_ROOT, "index.html");
  await writeFile(indexPath, html, "utf-8");
  console.log(`✅ Index HTML written to ${indexPath}`);
}

// Helper function for HTML generation (hoisted for use in template)
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
