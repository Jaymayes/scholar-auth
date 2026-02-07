import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-404-title">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            The page you're looking for doesn't exist or has been moved.
          </p>

          <div className="mt-6">
            <Link href="/">
              <Button className="w-full" data-testid="button-go-home">
                <Home className="w-4 h-4 mr-2" aria-hidden="true" />
                Go to Homepage
              </Button>
            </Link>
          </div>

          <nav className="mt-6 pt-4 border-t border-border flex flex-wrap gap-4 justify-center text-sm" aria-label="Legal links">
            <Link 
              href="/privacy" 
              className="text-muted-foreground hover:text-primary transition-colors"
              data-testid="link-privacy"
            >
              Privacy Policy
            </Link>
            <Link 
              href="/terms" 
              className="text-muted-foreground hover:text-primary transition-colors"
              data-testid="link-terms"
            >
              Terms of Service
            </Link>
            <Link 
              href="/accessibility" 
              className="text-muted-foreground hover:text-primary transition-colors"
              data-testid="link-accessibility"
            >
              Accessibility
            </Link>
          </nav>
        </CardContent>
      </Card>
    </div>
  );
}
