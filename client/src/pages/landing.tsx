import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/layout/Footer";
import { SEO, getOrganizationSchema, getWebSiteSchema } from "@/components/SEO";
import { GraduationCap, Shield, Clock, Eye, Zap, Award, Accessibility, Brain } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

export default function Landing() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const combinedSchema = {
    "@context": "https://schema.org",
    "@graph": [
      getOrganizationSchema(),
      getWebSiteSchema()
    ]
  };

  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <>
      <SEO 
        title="ScholarshipAI - Secure Enterprise Authentication Platform | 60ms P95 Performance"
        description="ScholarshipAI provides enterprise-grade authentication with WCAG 2.2 AA accessibility, 60ms P95 performance, and comprehensive OAuth support. Secure, fast, and accessible authentication built for students and educational institutions."
        canonicalPath="/"
        schema={combinedSchema}
      />
      <div className="min-h-screen bg-background">
      
      {/* Hero Background - Clean gradient without image */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-secondary/10"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent"></div>
      </div>

      {/* Navigation Header */}
      <nav className="relative z-10 bg-card/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <GraduationCap className="text-primary-foreground" size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">ScholarshipAI</h1>
                <p className="text-xs text-muted-foreground">Secure Authentication</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="security-badge px-3 py-1 rounded-full text-white text-xs font-medium hidden md:flex">
                <Shield className="mr-1 w-3 h-3 inline" />
                SSL Secured
              </div>
              <div className="performance-badge px-3 py-1 rounded-full bg-green-600 text-white text-xs font-medium hidden md:flex">
                <Zap className="mr-1 w-3 h-3 inline" />
                60ms Auth
              </div>
              {!isLoading && !isAuthenticated && (
                <Button
                  onClick={handleLogin}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-login"
                >
                  Sign In
                </Button>
              )}
              {!isLoading && isAuthenticated && (
                <Button
                  onClick={() => setLocation('/')}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-dashboard"
                >
                  Dashboard
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-4xl w-full text-center">
          <div className="mb-12">
            <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
              Welcome to ScholarshipAI
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Discover scholarship opportunities with AI-powered matching and secure, enterprise-grade authentication.
            </p>
            {!isLoading && !isAuthenticated && (
              <Button
                onClick={handleLogin}
                size="lg"
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-lg px-8 py-4"
                data-testid="button-get-started"
              >
                Get Started
              </Button>
            )}
            {!isLoading && isAuthenticated && (
              <Button
                onClick={() => setLocation('/')}
                size="lg"
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-lg px-8 py-4"
                data-testid="button-go-to-dashboard"
              >
                Go to Dashboard
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <Footer variant="full" />
    </div>
    </>
  );
}
