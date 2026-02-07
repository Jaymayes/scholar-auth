import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, ExternalLink, Eye } from "lucide-react";

export function ReplitAuthBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if opened outside Replit preview
    const isReplitPreview = 
      window.location.hostname.includes('.replit.dev') ||
      window.location.hostname.includes('.spock.replit.dev') ||
      window.location.hostname.includes('.janeway.replit.dev') ||
      document.referrer.includes('replit.com');

    // Check if in standalone browser (not embedded in Replit)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                        (window.navigator as any).standalone ||
                        !window.opener;

    // Show banner if in Replit domain but not in preview/embedded context
    const shouldShowBanner = 
      (isReplitPreview && isStandalone) ||
      (!isReplitPreview && window.location.hostname !== 'localhost');

    setShowBanner(shouldShowBanner);
  }, []);

  const handleOpenPreview = () => {
    // Guide users to access the Replit workspace manually
    // We cannot reliably auto-navigate from external browser to Replit preview
    alert('To access the Replit preview:\n\n1. Go to replit.com\n2. Find your project in "My Repls"\n3. Click "Run" or "Open"\n4. Use the preview window that appears');
  };

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  if (!showBanner || isDismissed) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950 dark:border-amber-700" data-testid="alert-replit-auth">
        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-900 dark:text-amber-100 font-semibold mb-2">
          For the Most Accurate Replit Auth Testing
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-200 space-y-3">
          <p className="text-sm">
            Opening this URL in an external browser may cause authentication restrictions due to Replit platform security policies.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleOpenPreview}
              variant="default"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="button-open-preview"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              How to Use Preview Window
            </Button>
            <Button
              onClick={() => {
                // Copy current URL to clipboard for easy pasting in incognito
                navigator.clipboard.writeText(window.location.href).then(() => {
                  alert('URL copied! Now open an incognito window and paste the URL.');
                });
              }}
              variant="outline"
              size="sm"
              className="border-amber-600 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900"
              data-testid="button-try-incognito"
            >
              <Eye className="mr-2 h-4 w-4" />
              Copy URL for Incognito
            </Button>
          </div>

          <p className="text-xs text-amber-700 dark:text-amber-300">
            <strong>Workaround:</strong> If you continue to see "External page" errors, use the Replit preview window or open in an incognito/private browsing window.
          </p>

          <Button
            onClick={handleDismiss}
            variant="ghost"
            size="sm"
            className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
            data-testid="button-dismiss-banner"
          >
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
