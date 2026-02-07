// API Configuration for Emergency CDN Migration
// Feature flag support for canary rollout to api.scholarshipai.com

export interface ApiConfig {
  baseUrl: string;
  corsEnabled: boolean;
  version: 'v1' | 'v2';
  retryAttempts: number;
}

// API Base URLs
const API_ENDPOINTS = {
  // Current (CDN-blocked)
  replit: 'https://scholar-auth-jamarrlmayes.replit.app',
  // Emergency edge-protected endpoint
  edge: 'https://api.scholarshipai.com',
  // Local development
  local: 'http://localhost:5000'
} as const;

// Feature flags for progressive rollout and COPPA compliance
const MIGRATION_FLAGS = {
  // Percentage of users to route to new API (0-100)
  edgeApiRolloutPercent: parseInt(import.meta.env.VITE_EDGE_ROLLOUT_PERCENT || '0'),
  // Force edge API for testing
  forceEdgeApi: import.meta.env.VITE_FORCE_EDGE_API === 'true',
  // Enable v2 API endpoints
  useV2Endpoints: import.meta.env.VITE_USE_V2_ENDPOINTS === 'true'
} as const;

// COPPA compliance feature flags for emergency hotfix rollout
const COPPA_FLAGS = {
  // Percentage of users to enable COPPA age verification (0-100)
  coppaRolloutPercent: parseInt(import.meta.env.VITE_COPPA_ROLLOUT_PERCENT || '100'),
  // Force COPPA enabled for testing
  forceCoppaEnabled: import.meta.env.VITE_FORCE_COPPA_ENABLED === 'true',
  // Disable COPPA entirely for emergency rollback
  coppaDisabled: import.meta.env.VITE_COPPA_DISABLED === 'true'
} as const;

/**
 * Get API base URL based on feature flags and environment
 */
export function getApiConfig(): ApiConfig {
  const isDevelopment = import.meta.env.DEV;
  
  // Development always uses local
  if (isDevelopment) {
    return {
      baseUrl: API_ENDPOINTS.local,
      corsEnabled: true,
      version: 'v1',
      retryAttempts: 2
    };
  }
  
  // Force edge API for testing
  if (MIGRATION_FLAGS.forceEdgeApi) {
    return {
      baseUrl: API_ENDPOINTS.edge,
      corsEnabled: true,
      version: MIGRATION_FLAGS.useV2Endpoints ? 'v2' : 'v1',
      retryAttempts: 3
    };
  }
  
  // Progressive rollout logic
  const userRolloutId = getUserRolloutId();
  const shouldUseEdgeApi = userRolloutId < MIGRATION_FLAGS.edgeApiRolloutPercent;
  
  return {
    baseUrl: shouldUseEdgeApi ? API_ENDPOINTS.edge : API_ENDPOINTS.replit,
    corsEnabled: true,
    version: MIGRATION_FLAGS.useV2Endpoints ? 'v2' : 'v1',
    retryAttempts: shouldUseEdgeApi ? 3 : 1 // More retries for new endpoint
  };
}

/**
 * Get consistent user rollout ID (0-99) based on session
 */
function getUserRolloutId(): number {
  const storageKey = 'scholar_rollout_id';
  
  let rolloutId = sessionStorage.getItem(storageKey);
  if (!rolloutId) {
    // Generate consistent ID for this session
    rolloutId = Math.floor(Math.random() * 100).toString();
    sessionStorage.setItem(storageKey, rolloutId);
  }
  
  return parseInt(rolloutId);
}

/**
 * Build API URL with version and endpoint
 */
export function buildApiUrl(endpoint: string, config?: ApiConfig): string {
  const apiConfig = config || getApiConfig();
  
  // Remove leading slash if present
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  
  // Use versioned endpoint for v2
  if (apiConfig.version === 'v2' && cleanEndpoint.startsWith('api/')) {
    const versionedEndpoint = cleanEndpoint.replace('api/', 'api/v2/');
    return `${apiConfig.baseUrl}/${versionedEndpoint}`;
  }
  
  return `${apiConfig.baseUrl}/${cleanEndpoint}`;
}

/**
 * Check if current config is using edge API
 */
export function isUsingEdgeApi(): boolean {
  return getApiConfig().baseUrl === API_ENDPOINTS.edge;
}

/**
 * Check if COPPA age verification should be enabled for current user
 */
export function isCoppaEnabled(): boolean {
  // Emergency disable flag takes precedence
  if (COPPA_FLAGS.coppaDisabled) {
    return false;
  }
  
  // Force enable for testing
  if (COPPA_FLAGS.forceCoppaEnabled) {
    return true;
  }
  
  // Development always enabled for testing
  if (import.meta.env.DEV) {
    return true;
  }
  
  // Progressive rollout logic using same user ID for consistency
  const userRolloutId = getUserRolloutId();
  return userRolloutId < COPPA_FLAGS.coppaRolloutPercent;
}

/**
 * Get COPPA rollout configuration info
 */
export function getCoppaRolloutInfo() {
  return {
    enabled: isCoppaEnabled(),
    rolloutPercent: COPPA_FLAGS.coppaRolloutPercent,
    userRolloutId: getUserRolloutId(),
    forceCoppaEnabled: COPPA_FLAGS.forceCoppaEnabled,
    coppaDisabled: COPPA_FLAGS.coppaDisabled
  };
}

// Export for debugging
export const debugInfo = {
  apiEndpoints: API_ENDPOINTS,
  migrationFlags: MIGRATION_FLAGS,
  coppaFlags: COPPA_FLAGS,
  currentConfig: getApiConfig(),
  coppaRolloutInfo: getCoppaRolloutInfo(),
  userRolloutId: getUserRolloutId()
};

// Log configuration in development
if (import.meta.env.DEV) {
  console.log('🔧 API Configuration:', debugInfo);
}