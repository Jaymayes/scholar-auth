// Health Widget - P0 Hardening Requirement
// Non-user-facing diagnostics panel for CORS status monitoring

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface CorsHealthStatus {
  ok: boolean;
  originEcho: string | null;
  originAllowed: boolean;
  fallbackActive: boolean;
  env: string;
  timestamp?: string;
}

export function HealthWidget() {
  const [corsStatus, setCorsStatus] = useState<CorsHealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const checkCorsHealth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/healthz/cors', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      
      const data = await response.json();
      setCorsStatus(data);
      setLastCheck(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCorsStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check on mount
    checkCorsHealth();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(checkCorsHealth, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = () => {
    if (loading) return <RefreshCw className="h-4 w-4 animate-spin" />;
    if (error) return <XCircle className="h-4 w-4 text-destructive" />;
    if (corsStatus?.originAllowed) return <CheckCircle className="h-4 w-4 text-green-600" />;
    return <AlertCircle className="h-4 w-4 text-yellow-600" />;
  };

  const getStatusBadge = () => {
    if (loading) return <Badge variant="secondary">Checking...</Badge>;
    if (error) return <Badge variant="destructive">Error</Badge>;
    if (corsStatus?.originAllowed) return <Badge variant="default" className="bg-green-600">Allowed</Badge>;
    return <Badge variant="secondary">Blocked</Badge>;
  };

  // Only show in development or when explicitly enabled
  const isDev = import.meta.env.DEV;
  const showHealthWidget = isDev || localStorage.getItem('show-health-widget') === 'true';
  
  if (!showHealthWidget) return null;

  return (
    <Card className="fixed bottom-4 right-4 w-80 border-2 bg-background/95 backdrop-blur-sm z-50" data-testid="health-widget">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {getStatusIcon()}
          CORS Health Status
          <button 
            onClick={checkCorsHealth}
            className="ml-auto text-xs opacity-60 hover:opacity-100"
            data-testid="refresh-health-status"
          >
            Refresh
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span>Status:</span>
            {getStatusBadge()}
          </div>
          
          {corsStatus && (
            <>
              <div className="flex justify-between">
                <span>Environment:</span>
                <Badge variant="outline" className="text-xs">
                  {corsStatus.env}
                </Badge>
              </div>
              
              <div className="flex justify-between">
                <span>Origin:</span>
                <span className="text-right text-muted-foreground max-w-48 truncate" title={corsStatus.originEcho || 'none'}>
                  {corsStatus.originEcho || 'none'}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span>Fallback:</span>
                <span className={corsStatus.fallbackActive ? 'text-yellow-600' : 'text-green-600'}>
                  {corsStatus.fallbackActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </>
          )}
          
          {error && (
            <div className="text-destructive text-xs bg-destructive/10 p-1 rounded">
              {error}
            </div>
          )}
          
          {lastCheck && (
            <div className="text-muted-foreground text-xs pt-1 border-t">
              Last check: {lastCheck.toLocaleTimeString()}
            </div>
          )}
        </div>
        
        {isDev && (
          <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
            Dev mode: Auto-refresh every 30s
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Dev console helper
if (import.meta.env.DEV) {
  (window as any).showHealthWidget = () => {
    localStorage.setItem('show-health-widget', 'true');
    window.location.reload();
  };
  
  (window as any).hideHealthWidget = () => {
    localStorage.removeItem('show-health-widget');
    window.location.reload();
  };
  
  console.log('💊 Health Widget available. Use showHealthWidget() or hideHealthWidget() in console.');
}