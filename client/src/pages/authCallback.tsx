import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // P0 SAFETY NET: If IdP redirects here with code/state, bounce to server immediately
  // This bypasses the sessionStorage limitation on cross-domain redirects
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const success = urlParams.get('success');
  const redirected = urlParams.get('redirected'); // Loop breaker flag
  
  // Only redirect once - if 'redirected' flag is set, we already tried server and it failed
  // This prevents infinite loop when PKCE cookie is missing/expired
  if (code && state && !success && !redirected) {
    // Redirect to server-side /api/callback to complete exchange with cookie-based PKCE
    // Include redirected=1 flag so if server bounces back, we show error instead of looping
    window.location.href = `/api/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}&redirected=1`;
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Redirecting to secure login...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // P0 FIX: Handle server-side completion (new flow)
        const success = urlParams.get('success');
        const returnTo = urlParams.get('return_to');
        const errorParam = urlParams.get('error');
        
        // Handle error redirects from server
        if (errorParam) {
          setStatus('error');
          const reasonParam = urlParams.get('reason');
          const errorMessages: Record<string, string> = {
            'missing_parameters': 'Missing authorization code or state. Please try logging in again.',
            'invalid_session': 'Your login session was invalid. Please try again.',
            'session_expired': 'Your login session expired. Please try again.',
            'invalid_state': 'Invalid state parameter. Possible security issue detected.',
            'server_error': 'An unexpected server error occurred. Please try again.',
          };
          // P0 DIAGNOSTIC (Dec 24, 2025): Surface error reason for operators (redacted)
          const reasonDescriptions: Record<string, string> = {
            'expired_auth_code': 'Login session timed out.',
            'client_configuration': 'Configuration issue detected.',
            'pkce_mismatch': 'Security verification failed.',
            'upstream_unavailable': 'Identity provider temporarily unavailable.',
            'upstream_auth_rejection': 'Identity provider rejected request.',
            'unknown': 'Unexpected error.',
          };
          const baseMessage = errorMessages[errorParam] || 'Authentication failed. Please try again.';
          const reasonNote = reasonParam && reasonDescriptions[reasonParam] 
            ? ` (${reasonDescriptions[reasonParam]})` 
            : '';
          setErrorMessage(baseMessage + reasonNote);
          return;
        }
        
        // Handle successful server-side completion
        if (success === 'true') {
          setStatus('success');
          sessionStorage.removeItem('oauth_code_verifier');
          sessionStorage.removeItem('oauth_state');
          
          setTimeout(() => {
            const destination = returnTo || '/';
            // P0 FIX: Use full page navigation for server-side routes (OIDC interaction resume)
            // Client-side navigation (navigate()) doesn't hit the server, breaking the OIDC flow
            if (destination.startsWith('/oidc/')) {
              window.location.href = destination;
            } else {
              navigate(destination);
            }
          }, 1500);
          return;
        }
        
        // Fallback: Client-side completion (legacy flow)
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        
        if (!code || !state) {
          setStatus('error');
          setErrorMessage('Missing authorization code or state. Please try logging in again.');
          return;
        }
        
        // Try sessionStorage first (backward compatibility)
        const codeVerifier = sessionStorage.getItem('oauth_code_verifier');
        const savedState = sessionStorage.getItem('oauth_state');
        
        if (!codeVerifier) {
          setStatus('error');
          setErrorMessage('Login session expired. Please try again.');
          return;
        }
        
        if (savedState !== state) {
          setStatus('error');
          setErrorMessage('Invalid state parameter. Possible CSRF attack detected.');
          sessionStorage.removeItem('oauth_code_verifier');
          sessionStorage.removeItem('oauth_state');
          return;
        }
        
        const response = await fetch('/api/auth/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            code,
            state,
            code_verifier: codeVerifier,
          }),
        });
        
        sessionStorage.removeItem('oauth_code_verifier');
        sessionStorage.removeItem('oauth_state');
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({ message: 'Authentication failed' }));
          setStatus('error');
          setErrorMessage(error.message || 'Authentication failed. Please try again.');
          return;
        }
        
        setStatus('success');
        
        setTimeout(() => {
          navigate('/');
        }, 1500);
      } catch (error) {
        setStatus('error');
        setErrorMessage('An unexpected error occurred. Please try again.');
        console.error('Auth callback error:', error);
      }
    };
    
    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md" data-testid="card-auth-callback">
        <CardHeader>
          <CardTitle className="text-center">
            {status === 'loading' && 'Completing Authentication'}
            {status === 'success' && 'Authentication Successful'}
            {status === 'error' && 'Authentication Failed'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === 'loading' && (
            <>
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" data-testid="icon-loading" />
              <p className="text-muted-foreground">
                Please wait while we complete your authentication...
              </p>
            </>
          )}
          
          {status === 'success' && (
            <>
              <CheckCircle2 className="w-12 h-12 mx-auto text-green-500" data-testid="icon-success" />
              <p className="text-muted-foreground">
                Authentication successful! Redirecting to your dashboard...
              </p>
            </>
          )}
          
          {status === 'error' && (
            <>
              <XCircle className="w-12 h-12 mx-auto text-destructive" data-testid="icon-error" />
              <p className="text-destructive font-medium" data-testid="text-error-message">
                {errorMessage}
              </p>
              <div className="pt-4">
                <Button
                  onClick={() => navigate('/auth')}
                  variant="default"
                  className="w-full"
                  data-testid="button-try-again"
                >
                  Try Again
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
