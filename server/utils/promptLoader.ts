import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

/**
 * System Prompt Loader
 * 
 * Loads shared_directives.prompt + app-specific overlay at startup.
 * Caches prompts with SHA-256 hash for verification.
 * 
 * Per CEO directive:
 * - Load order: shared_directives.prompt → <app>.prompt
 * - Expose via GET /api/prompts, GET /api/prompts/:app, GET /api/prompts/verify
 * - Version with hash for cache validation
 */

const PROMPTS_DIR = join(process.cwd(), 'docs', 'system-prompts');
const SHARED_DIRECTIVES = 'shared_directives.prompt';
const UNIVERSAL_PROMPT = 'universal.prompt';

// Feature flag: separate (per-app files) or universal (runtime overlay selection)
const PROMPT_MODE = (process.env.PROMPT_MODE || 'separate') as 'separate' | 'universal';

// App name from environment (for universal mode)
const APP_NAME = process.env.APP_NAME as AppName | undefined;

// Valid app names (must match filenames)
export const VALID_APPS = [
  'scholar_auth',
  'student_pilot',
  'provider_register',
  'scholarship_api',
  'executive_command_center',
  'auto_page_maker',
  'scholarship_agent',
  'scholarship_sage',
] as const;

export type AppName = typeof VALID_APPS[number];
export type PromptMode = 'separate' | 'universal';

export interface PromptMetadata {
  app: AppName;
  version: string;
  hash: string;
  loadedAt: string;
  sharedDirectivesHash: string;
  appOverlayHash: string;
  lines: number;
}

export interface LoadedPrompt extends PromptMetadata {
  content: string;
}

// In-memory cache
const promptCache = new Map<AppName, LoadedPrompt>();
let sharedDirectivesContent: string = '';
let sharedDirectivesHash: string = '';

// Universal prompt cache
let universalPromptContent: string = '';
let universalPromptHash: string = '';
const universalOverlayCache = new Map<AppName, string>();

/**
 * Compute SHA-256 hash of content
 */
function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').substring(0, 16);
}

/**
 * Parse universal prompt and extract sections
 * Returns: { meta, shared, overlays }
 * 
 * Supports three formats:
 * 1. Legacy: [META], [SHARED], [APP: app_name], [FAILSAFE]
 * 2. v1.1 (verbose): Section A-H with "Overlay: app_name" in Section F
 * 3. v1.1 (compact): A) B) C) with "1. app_name" in F)
 */
function parseUniversalPrompt(content: string): {
  meta: string;
  shared: string;
  overlays: Map<AppName, string>;
} {
  // Detect format by checking for markers
  const isV11Verbose = content.includes('Section A — How Agent3 must use this prompt');
  const isV11Compact = content.includes('A) Routing and Isolation');
  
  if (isV11Compact) {
    return parseUniversalPromptV11Compact(content);
  } else if (isV11Verbose) {
    return parseUniversalPromptV11(content);
  } else {
    return parseUniversalPromptLegacy(content);
  }
}

/**
 * Parse v1.1 Section-based universal prompt
 * Sections: A (routing), B-E (shared), F (overlays), G-H (shared)
 */
function parseUniversalPromptV11(content: string): {
  meta: string;
  shared: string;
  overlays: Map<AppName, string>;
} {
  const lines = content.split('\n');
  const overlays = new Map<AppName, string>();
  
  let currentSection: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | null = null;
  let currentOverlay: AppName | null = null;
  
  // Content collectors
  const sectionA: string[] = []; // Routing rules
  const sectionB: string[] = []; // Company Core
  const sectionC: string[] = []; // Global Guardrails
  const sectionD: string[] = []; // KPIs & Telemetry
  const sectionE: string[] = []; // SLOs
  const sectionG: string[] = []; // Operating Procedure
  const sectionH: string[] = []; // Definition of Done
  let overlayContent: string[] = [];
  
  for (const line of lines) {
    // Section detection (A-H)
    if (line.match(/^Section A\s*—/i)) {
      currentSection = 'A';
      currentOverlay = null;
      sectionA.push(line);
      continue;
    } else if (line.match(/^Section B\s*—/i)) {
      currentSection = 'B';
      currentOverlay = null;
      sectionB.push(line);
      continue;
    } else if (line.match(/^Section C\s*—/i)) {
      currentSection = 'C';
      currentOverlay = null;
      sectionC.push(line);
      continue;
    } else if (line.match(/^Section D\s*—/i)) {
      currentSection = 'D';
      currentOverlay = null;
      sectionD.push(line);
      continue;
    } else if (line.match(/^Section E\s*—/i)) {
      currentSection = 'E';
      currentOverlay = null;
      sectionE.push(line);
      continue;
    } else if (line.match(/^Section F\s*—/i)) {
      currentSection = 'F';
      currentOverlay = null;
      continue;
    } else if (line.match(/^Section G\s*—/i)) {
      currentSection = 'G';
      currentOverlay = null;
      sectionG.push(line);
      continue;
    } else if (line.match(/^Section H\s*—/i)) {
      currentSection = 'H';
      currentOverlay = null;
      sectionH.push(line);
      continue;
    }
    
    // Overlay detection within Section F
    if (currentSection === 'F' && line.match(/^Overlay:\s*(\w+)/)) {
      // Save previous overlay if exists
      if (currentOverlay) {
        overlays.set(currentOverlay, overlayContent.join('\n').trim());
        overlayContent = [];
      }
      
      const match = line.match(/^Overlay:\s*(\w+)/);
      const appKey = match?.[1];
      
      if (appKey && VALID_APPS.includes(appKey as AppName)) {
        currentOverlay = appKey as AppName;
      }
      continue;
    }
    
    // Collect content based on current section
    if (currentSection === 'A') {
      sectionA.push(line);
    } else if (currentSection === 'B') {
      sectionB.push(line);
    } else if (currentSection === 'C') {
      sectionC.push(line);
    } else if (currentSection === 'D') {
      sectionD.push(line);
    } else if (currentSection === 'E') {
      sectionE.push(line);
    } else if (currentSection === 'F' && currentOverlay) {
      overlayContent.push(line);
    } else if (currentSection === 'G') {
      sectionG.push(line);
    } else if (currentSection === 'H') {
      sectionH.push(line);
    }
  }
  
  // Save final overlay
  if (currentOverlay) {
    overlays.set(currentOverlay, overlayContent.join('\n').trim());
  }
  
  // Build meta (Section A)
  const meta = sectionA.join('\n').trim();
  
  // Build shared (Sections A, B, C, D, E, G, H)
  const shared = [
    ...sectionA,
    '',
    ...sectionB,
    '',
    ...sectionC,
    '',
    ...sectionD,
    '',
    ...sectionE,
    '',
    ...sectionG,
    '',
    ...sectionH,
  ].join('\n').trim();
  
  return { meta, shared, overlays };
}

/**
 * Parse v1.1 Compact universal prompt
 * Sections: A) B) C) D) E) F) G) H) with "1. app_name" in F)
 */
function parseUniversalPromptV11Compact(content: string): {
  meta: string;
  shared: string;
  overlays: Map<AppName, string>;
} {
  const lines = content.split('\n');
  const overlays = new Map<AppName, string>();
  
  let currentSection: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | null = null;
  let currentOverlay: AppName | null = null;
  
  // Content collectors
  const sectionA: string[] = []; // Routing rules
  const sectionB: string[] = []; // Company Core
  const sectionC: string[] = []; // Global Guardrails
  const sectionD: string[] = []; // KPIs & Telemetry
  const sectionE: string[] = []; // SLOs
  const sectionG: string[] = []; // Operating Procedure
  const sectionH: string[] = []; // Definition of Done
  let overlayContent: string[] = [];
  
  for (const line of lines) {
    // Section detection (compact format A) B) C) etc.)
    if (line.match(/^A\)\s+/i)) {
      currentSection = 'A';
      currentOverlay = null;
      sectionA.push(line);
      continue;
    } else if (line.match(/^B\)\s+/i)) {
      currentSection = 'B';
      currentOverlay = null;
      sectionB.push(line);
      continue;
    } else if (line.match(/^C\)\s+/i)) {
      currentSection = 'C';
      currentOverlay = null;
      sectionC.push(line);
      continue;
    } else if (line.match(/^D\)\s+/i)) {
      currentSection = 'D';
      currentOverlay = null;
      sectionD.push(line);
      continue;
    } else if (line.match(/^E\)\s+/i)) {
      currentSection = 'E';
      currentOverlay = null;
      sectionE.push(line);
      continue;
    } else if (line.match(/^F\)\s+/i)) {
      currentSection = 'F';
      currentOverlay = null;
      continue;
    } else if (line.match(/^G\)\s+/i)) {
      currentSection = 'G';
      currentOverlay = null;
      sectionG.push(line);
      continue;
    } else if (line.match(/^H\)\s+/i)) {
      currentSection = 'H';
      currentOverlay = null;
      sectionH.push(line);
      continue;
    }
    
    // Overlay detection within Section F (format: "1. executive_command_center")
    if (currentSection === 'F' && line.match(/^\d+\.\s+(\w+)/)) {
      // Save previous overlay if exists
      if (currentOverlay) {
        overlays.set(currentOverlay, overlayContent.join('\n').trim());
        overlayContent = [];
      }
      
      const match = line.match(/^\d+\.\s+(\w+)/);
      const appKey = match?.[1];
      
      if (appKey && VALID_APPS.includes(appKey as AppName)) {
        currentOverlay = appKey as AppName;
        overlayContent.push(line); // Include the app name line
      }
      continue;
    }
    
    // Collect content based on current section
    if (currentSection === 'A') {
      sectionA.push(line);
    } else if (currentSection === 'B') {
      sectionB.push(line);
    } else if (currentSection === 'C') {
      sectionC.push(line);
    } else if (currentSection === 'D') {
      sectionD.push(line);
    } else if (currentSection === 'E') {
      sectionE.push(line);
    } else if (currentSection === 'F' && currentOverlay) {
      overlayContent.push(line);
    } else if (currentSection === 'G') {
      sectionG.push(line);
    } else if (currentSection === 'H') {
      sectionH.push(line);
    }
  }
  
  // Save final overlay
  if (currentOverlay) {
    overlays.set(currentOverlay, overlayContent.join('\n').trim());
  }
  
  // Build meta (Section A)
  const meta = sectionA.join('\n').trim();
  
  // Build shared (Sections A, B, C, D, E, G, H)
  const shared = [
    ...sectionA,
    '',
    ...sectionB,
    '',
    ...sectionC,
    '',
    ...sectionD,
    '',
    ...sectionE,
    '',
    ...sectionG,
    '',
    ...sectionH,
  ].join('\n').trim();
  
  return { meta, shared, overlays };
}

/**
 * Parse legacy [TAG]-based universal prompt
 * Supports: [META], [SHARED], [APP: app_name], [FAILSAFE]
 */
function parseUniversalPromptLegacy(content: string): {
  meta: string;
  shared: string;
  overlays: Map<AppName, string>;
} {
  const lines = content.split('\n');
  const overlays = new Map<AppName, string>();
  
  let currentSection: 'meta' | 'shared' | 'app' | 'failsafe' | null = null;
  let currentApp: AppName | null = null;
  
  let metaContent: string[] = [];
  let sharedContent: string[] = [];
  let appContent: string[] = [];
  let failsafeContent: string[] = [];
  
  for (const line of lines) {
    // Section detection
    if (line.startsWith('[META]')) {
      currentSection = 'meta';
      continue;
    } else if (line.startsWith('[SHARED]')) {
      currentSection = 'shared';
      continue;
    } else if (line.match(/^\[APP: (\w+)\]/)) {
      // Save previous app overlay if exists
      if (currentApp && currentSection === 'app') {
        overlays.set(currentApp, appContent.join('\n').trim());
        appContent = [];
      }
      
      const match = line.match(/^\[APP: (\w+)\]/);
      const appKey = match?.[1];
      
      if (appKey && VALID_APPS.includes(appKey as AppName)) {
        currentApp = appKey as AppName;
        currentSection = 'app';
      }
      continue;
    } else if (line.startsWith('[FAILSAFE]')) {
      // Save previous app overlay if exists
      if (currentApp && currentSection === 'app') {
        overlays.set(currentApp, appContent.join('\n').trim());
        appContent = [];
      }
      currentSection = 'failsafe';
      continue;
    }
    
    // Collect content based on current section
    if (currentSection === 'meta') {
      metaContent.push(line);
    } else if (currentSection === 'shared') {
      sharedContent.push(line);
    } else if (currentSection === 'app') {
      appContent.push(line);
    } else if (currentSection === 'failsafe') {
      failsafeContent.push(line);
    }
  }
  
  // Save final app overlay
  if (currentApp && currentSection === 'app') {
    overlays.set(currentApp, appContent.join('\n').trim());
  }
  
  // Combine meta + shared + failsafe as the "shared" content
  const meta = metaContent.join('\n').trim();
  const shared = [
    ...metaContent,
    '',
    '[SHARED]',
    ...sharedContent,
    '',
    '[FAILSAFE]',
    ...failsafeContent,
  ].join('\n').trim();
  
  return { meta, shared, overlays };
}

/**
 * Load universal prompt
 */
function loadUniversalPrompt(): void {
  try {
    const filePath = join(PROMPTS_DIR, UNIVERSAL_PROMPT);
    universalPromptContent = readFileSync(filePath, 'utf8');
    universalPromptHash = computeHash(universalPromptContent);
    
    const { shared, overlays } = parseUniversalPrompt(universalPromptContent);
    
    // Cache shared content
    sharedDirectivesContent = shared;
    sharedDirectivesHash = computeHash(shared);
    
    // Cache overlays
    for (const [app, overlay] of Array.from(overlays.entries())) {
      universalOverlayCache.set(app, overlay);
    }
    
    console.log(`[PROMPT_LOADER] Loaded ${UNIVERSAL_PROMPT} (hash: ${universalPromptHash}, ${overlays.size} overlays)`);
  } catch (error) {
    console.error(`[PROMPT_LOADER] WARNING: Failed to load ${UNIVERSAL_PROMPT}:`, error);
    console.error(`[PROMPT_LOADER] File path attempted: ${join(PROMPTS_DIR, UNIVERSAL_PROMPT)}`);
    console.error(`[PROMPT_LOADER] Using fallback mode with empty content`);
    // Use empty fallback
    universalPromptContent = '# FALLBACK: Universal prompt not loaded\n';
    universalPromptHash = computeHash(universalPromptContent);
    sharedDirectivesContent = '# FALLBACK: Shared directives not loaded\n';
    sharedDirectivesHash = computeHash(sharedDirectivesContent);
  }
}

/**
 * Load app prompt from universal overlay
 */
function loadAppPromptFromUniversal(app: AppName): LoadedPrompt {
  const overlay = universalOverlayCache.get(app);
  
  if (!overlay) {
    throw new Error(`No overlay found for ${app} in universal.prompt`);
  }
  
  const appHash = computeHash(overlay);
  
  // Merge: shared + delimiter + app overlay
  const delimiter = `\n\n${'='.repeat(80)}\n# APP-SPECIFIC OVERLAY: ${app.toUpperCase()}\n${'='.repeat(80)}\n\n`;
  const mergedContent = sharedDirectivesContent + delimiter + overlay;
  const mergedHash = computeHash(mergedContent);
  
  // Add runtime context
  const runtimeContext = `\n\n${'='.repeat(80)}\n# RUNTIME CONTEXT\n${'='.repeat(80)}\n\nEnvironment: ${process.env.NODE_ENV || 'development'}\nVersion: ${process.env.npm_package_version || 'dev'}\nGit SHA: ${process.env.REPLIT_GIT_SHA || 'local'}\nPrompt Mode: universal\nLoaded at: ${new Date().toISOString()}\n`;
  const finalContent = mergedContent + runtimeContext;
  const finalHash = computeHash(finalContent);
  
  const loaded: LoadedPrompt = {
    app,
    version: process.env.npm_package_version || 'dev',
    hash: finalHash,
    loadedAt: new Date().toISOString(),
    sharedDirectivesHash,
    appOverlayHash: appHash,
    lines: finalContent.split('\n').length,
    content: finalContent,
  };
  
  console.log(`[PROMPT_LOADER] Loaded ${app} from universal (hash: ${finalHash}, lines: ${loaded.lines})`);
  return loaded;
}

/**
 * Load shared directives (global prime directive)
 */
function loadSharedDirectives(): void {
  try {
    const filePath = join(PROMPTS_DIR, SHARED_DIRECTIVES);
    sharedDirectivesContent = readFileSync(filePath, 'utf8');
    sharedDirectivesHash = computeHash(sharedDirectivesContent);
    console.log(`[PROMPT_LOADER] Loaded ${SHARED_DIRECTIVES} (hash: ${sharedDirectivesHash})`);
  } catch (error) {
    console.error(`[PROMPT_LOADER] WARNING: Failed to load ${SHARED_DIRECTIVES}:`, error);
    console.error(`[PROMPT_LOADER] File path attempted: ${join(PROMPTS_DIR, SHARED_DIRECTIVES)}`);
    console.error(`[PROMPT_LOADER] Using empty shared directives as fallback`);
    // Use empty fallback to prevent crash
    sharedDirectivesContent = '# FALLBACK: Shared directives not loaded\n';
    sharedDirectivesHash = computeHash(sharedDirectivesContent);
  }
}

/**
 * Load app-specific prompt overlay
 */
function loadAppPrompt(app: AppName): LoadedPrompt {
  const filename = `${app.replace(/-/g, '_')}.prompt`;
  const filePath = join(PROMPTS_DIR, filename);
  
  try {
    const appContent = readFileSync(filePath, 'utf8');
    const appHash = computeHash(appContent);
    
    // Merge: shared_directives + delimiter + app overlay
    const delimiter = `\n\n${'='.repeat(80)}\n# APP-SPECIFIC OVERLAY: ${app.toUpperCase()}\n${'='.repeat(80)}\n\n`;
    const mergedContent = sharedDirectivesContent + delimiter + appContent;
    const mergedHash = computeHash(mergedContent);
    
    // Add runtime context
    const runtimeContext = `\n\n${'='.repeat(80)}\n# RUNTIME CONTEXT\n${'='.repeat(80)}\n\nEnvironment: ${process.env.NODE_ENV || 'development'}\nVersion: ${process.env.npm_package_version || 'dev'}\nGit SHA: ${process.env.REPLIT_GIT_SHA || 'local'}\nLoaded at: ${new Date().toISOString()}\n`;
    const finalContent = mergedContent + runtimeContext;
    const finalHash = computeHash(finalContent);
    
    const loaded: LoadedPrompt = {
      app,
      version: process.env.npm_package_version || 'dev',
      hash: finalHash,
      loadedAt: new Date().toISOString(),
      sharedDirectivesHash,
      appOverlayHash: appHash,
      lines: finalContent.split('\n').length,
      content: finalContent,
    };
    
    console.log(`[PROMPT_LOADER] Loaded ${app} (hash: ${finalHash}, lines: ${loaded.lines})`);
    return loaded;
  } catch (error) {
    console.error(`[PROMPT_LOADER] WARNING: Failed to load ${filename}:`, error);
    console.error(`[PROMPT_LOADER] File path attempted: ${filePath}`);
    console.error(`[PROMPT_LOADER] Using fallback for ${app}`);
    
    // Create fallback prompt
    const fallbackContent = `# FALLBACK PROMPT FOR ${app.toUpperCase()}\n\nPrompt file not found. Using minimal fallback configuration.\n`;
    const fallbackHash = computeHash(fallbackContent);
    
    return {
      app,
      version: process.env.npm_package_version || 'dev',
      hash: fallbackHash,
      loadedAt: new Date().toISOString(),
      sharedDirectivesHash: sharedDirectivesHash || 'fallback',
      appOverlayHash: fallbackHash,
      lines: fallbackContent.split('\n').length,
      content: fallbackContent,
    };
  }
}

/**
 * Load all prompts at startup
 */
export function loadAllPrompts(): void {
  console.log(`[PROMPT_LOADER] Loading all prompts... (mode: ${PROMPT_MODE})`);
  console.log(`[PROMPT_LOADER] Prompts directory: ${PROMPTS_DIR}`);
  
  const errors: Array<{ app: AppName; error: any }> = [];
  
  if (PROMPT_MODE === 'universal') {
    // Universal mode: Load universal.prompt and extract overlays
    loadUniversalPrompt(); // Now with fallback, won't throw
    
    // Load each app from universal overlays
    for (const app of VALID_APPS) {
      try {
        const loaded = loadAppPromptFromUniversal(app);
        promptCache.set(app, loaded);
      } catch (error) {
        console.warn(`[PROMPT_LOADER] Failed to load ${app} from universal, using fallback`);
        errors.push({ app, error });
      }
    }
  } else {
    // Separate mode: Load shared_directives + individual per-app files
    loadSharedDirectives(); // Now with fallback, won't throw
    
    for (const app of VALID_APPS) {
      const loaded = loadAppPrompt(app); // Now returns fallback instead of throwing
      promptCache.set(app, loaded);
    }
  }
  
  // Report results
  console.log(`[PROMPT_LOADER] Loaded ${promptCache.size}/${VALID_APPS.length} prompts`);
  
  if (errors.length > 0) {
    console.warn(`[PROMPT_LOADER] ${errors.length} prompts loaded with fallback: ${errors.map(e => e.app).join(', ')}`);
  }
  
  // Verify all hashes are unique
  const hashes = Array.from(promptCache.values()).map(p => p.hash);
  const uniqueHashes = new Set(hashes);
  
  if (hashes.length !== uniqueHashes.size) {
    console.warn('[PROMPT_LOADER] WARNING: Duplicate hashes detected!');
  }
  
  console.log(`[PROMPT_LOADER] ✅ All prompts loaded successfully (mode: ${PROMPT_MODE})`);
}

/**
 * Get prompt for specific app
 */
export function getPrompt(app: AppName): LoadedPrompt | null {
  return promptCache.get(app) || null;
}

/**
 * Get metadata for all prompts (without content)
 */
export function getAllPromptMetadata(): PromptMetadata[] {
  return Array.from(promptCache.values()).map(({ content, ...metadata }) => metadata);
}

/**
 * Verify all prompts loaded correctly
 */
export function verifyPrompts(): { success: boolean; errors: string[]; loaded: number; total: number } {
  const errors: string[] = [];
  
  // 1. Check shared directives loaded
  if (!sharedDirectivesContent || !sharedDirectivesHash) {
    errors.push('Shared directives not loaded');
  }
  
  // 2. Check all apps loaded
  for (const app of VALID_APPS) {
    if (!promptCache.has(app)) {
      errors.push(`Missing prompt for ${app}`);
    }
  }
  
  // 3. Check for duplicate hashes
  const hashes = Array.from(promptCache.values()).map(p => p.hash);
  const uniqueHashes = new Set(hashes);
  if (hashes.length !== uniqueHashes.size) {
    errors.push('Duplicate hashes detected - prompts may be identical');
  }
  
  return {
    success: errors.length === 0,
    errors,
    loaded: promptCache.size,
    total: VALID_APPS.length,
  };
}

/**
 * Reload prompts (for hot-reload in development)
 */
export function reloadPrompts(): void {
  promptCache.clear();
  loadAllPrompts();
}

/**
 * Get prompt mode (separate or universal)
 */
export function getPromptMode(): PromptMode {
  return PROMPT_MODE;
}

/**
 * Get app name from environment (for universal mode)
 */
export function getAppName(): AppName | undefined {
  return APP_NAME;
}

/**
 * Get universal prompt metadata (universal mode only)
 */
export function getUniversalPromptMetadata() {
  if (PROMPT_MODE !== 'universal') {
    return null;
  }
  
  return {
    hash: universalPromptHash,
    overlays: universalOverlayCache.size,
    apps: Array.from(universalOverlayCache.keys()),
  };
}

/**
 * Get overlay content for specific app (universal mode only, for debugging)
 */
export function getOverlay(app: AppName): string | null {
  if (PROMPT_MODE !== 'universal') {
    return null;
  }
  
  return universalOverlayCache.get(app) || null;
}
