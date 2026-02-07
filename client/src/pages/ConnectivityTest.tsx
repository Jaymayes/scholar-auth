import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, XCircle, Loader2, RefreshCw, Server } from "lucide-react";

interface ConnectivityResult {
  target_url: string;
  reachable: boolean;
  status_code: number | null;
  latency_ms: number;
  attempted_retries: number;
  final_error: string | null;
  timestamp: string;
}

export default function ConnectivityTest() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ConnectivityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runConnectivityTest = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/health/auto-com-center');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ConnectivityResult = await response.json();
      setResult(data);
      
    } catch (err: any) {
      setError(err.message || 'Failed to test connectivity');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            <Server className="inline-block mr-2 mb-1" size={32} />
            Connectivity Test
          </h1>
          <p className="text-muted-foreground">
            Test the connection from Scholar Auth to Auto Com Center
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Auto Com Center Connectivity</CardTitle>
            <CardDescription>
              Performs a server-side HTTP request to Auto Com Center with retry logic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button
              onClick={runConnectivityTest}
              disabled={isLoading}
              size="lg"
              className="w-full"
              data-testid="button-run-test"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Run Connectivity Test
                </>
              )}
            </Button>

            {error && (
              <Alert variant="destructive" data-testid="alert-error">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {result && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div className="flex items-center space-x-2">
                    {result.reachable ? (
                      <CheckCircle className="text-green-500" size={24} />
                    ) : (
                      <XCircle className="text-red-500" size={24} />
                    )}
                    <span className="font-semibold text-lg">
                      {result.reachable ? 'Connection Successful' : 'Connection Failed'}
                    </span>
                  </div>
                  <Badge variant={result.reachable ? 'default' : 'destructive'}>
                    {result.status_code || 'N/A'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Target URL</p>
                    <p className="font-mono text-sm break-all" data-testid="text-target-url">
                      {result.target_url}
                    </p>
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Latency</p>
                    <p className="font-semibold text-lg" data-testid="text-latency">
                      {result.latency_ms}ms
                    </p>
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Status Code</p>
                    <p className="font-semibold text-lg" data-testid="text-status-code">
                      {result.status_code || 'null'}
                    </p>
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Retries</p>
                    <p className="font-semibold text-lg" data-testid="text-retries">
                      {result.attempted_retries}
                    </p>
                  </div>
                </div>

                {result.final_error && (
                  <div className="p-4 bg-destructive/10 border border-destructive rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Error Details</p>
                    <p className="font-mono text-sm text-destructive" data-testid="text-error-details">
                      {result.final_error}
                    </p>
                  </div>
                )}

                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Timestamp</p>
                  <p className="font-mono text-sm" data-testid="text-timestamp">
                    {new Date(result.timestamp).toLocaleString()}
                  </p>
                </div>

                <details className="p-4 bg-muted rounded-lg">
                  <summary className="cursor-pointer font-semibold mb-2">
                    Raw JSON Response
                  </summary>
                  <pre className="bg-background p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Manual Testing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">cURL:</p>
              <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                curl -s https://scholar-auth-jamarrlmayes.replit.app/health/auto-com-center | jq
              </pre>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">JavaScript fetch:</p>
              <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`fetch('/health/auto-com-center')
  .then(res => res.json())
  .then(data => console.log(data));`}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
