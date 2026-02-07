import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// P0 HOTFIX: Endpoints that require credentials (cookies/auth)
const ENDPOINTS_REQUIRING_CREDENTIALS = new Set([
  '/api/auth/user',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/user/profile',
  '/api/applications',
  '/api/scholarships/applied'
]);

// Check if endpoint needs credentials
function requiresCredentials(url: string): boolean {
  return ENDPOINTS_REQUIRING_CREDENTIALS.has(url) || 
         url.includes('/auth/') || 
         url.includes('/user/');
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Build full URL - handle both relative and absolute URLs
  let fullUrl = url;
  if (!url.startsWith('http')) {
    // P0 HOTFIX: In dev, use same-origin to avoid CORS
    const baseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : '');
    fullUrl = `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`;
  }
  
  // P0 HOTFIX: Only include credentials when needed
  const needsCredentials = requiresCredentials(url);
  
  // SRE MANDATE: Cache-busting headers for Zero-Staleness
  const headers: Record<string, string> = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
  if (data) {
    headers['Content-Type'] = 'application/json';
  }
  
  const res = await fetch(fullUrl, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    ...(needsCredentials && { credentials: "include" }),
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Build URL from query key
    const url = queryKey.join("/") as string;
    
    // Build full URL - handle both relative and absolute URLs
    let fullUrl = url;
    if (!url.startsWith('http')) {
      // P0 HOTFIX: In dev, use same-origin to avoid CORS
      const baseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : '');
      fullUrl = `${baseUrl}${url.startsWith('/') ? url : `/${url}`}`;
    }
    
    // P0 HOTFIX: Only include credentials when needed
    const needsCredentials = requiresCredentials(url);
    
    // SRE MANDATE: Cache-busting headers for Zero-Staleness
    const res = await fetch(fullUrl, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      ...(needsCredentials && { credentials: "include" }),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// SRE MANDATE: Zero-Staleness Configuration
// Data freshness SLA: 5 seconds max staleness
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // SRE: Auto-poll every 5 seconds for real-time data
      refetchInterval: 5000,
      // SRE: Refresh when user returns to tab
      refetchOnWindowFocus: true,
      // SRE: Data expires after 5 seconds
      staleTime: 5000,
      // SRE: Disable deduping to ensure fresh reads
      gcTime: 0,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
