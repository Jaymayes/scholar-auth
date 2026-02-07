import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { useToast } from "@/hooks/use-toast";
import { LogIn, Eye, EyeOff, Code } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Here you would typically make an API call to authenticate
      // For now, we'll show a success message and redirect to Replit Auth
      toast({
        title: "Redirecting to secure login",
        description: "You will be redirected to complete authentication.",
      });
      
      // Redirect to Replit Auth
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 1000);
    } catch (error) {
      toast({
        title: "Authentication failed",
        description: "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReplitAuth = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/login');
      if (!response.ok) {
        throw new Error('Failed to initialize login');
      }
      
      const { authUrl, codeVerifier, state } = await response.json();
      
      sessionStorage.setItem('oauth_code_verifier', codeVerifier);
      sessionStorage.setItem('oauth_state', state);
      
      // Always use redirect flow (no popups - they get blocked)
      window.location.href = authUrl;
    } catch (error) {
      toast({
        title: "Authentication failed",
        description: "Failed to initialize authentication. Please try again.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <Card className="auth-card rounded-xl shadow-2xl p-8 max-w-md mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Welcome Back</h2>
        <p className="text-muted-foreground">Sign in to your ScholarshipAI account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email Input */}
        <FloatingLabelInput
          type="email"
          id="login-email"
          label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          data-testid="input-email"
        />

        {/* Password Input */}
        <div className="relative">
          <FloatingLabelInput
            type={showPassword ? "text" : "password"}
            id="login-password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            data-testid="input-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="default"
            className="absolute right-0 top-0 h-11 px-3"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            data-testid="button-toggle-password"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>

        {/* Remember Me & Forgot Password */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember-me"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
              data-testid="checkbox-remember-me"
            />
            <label htmlFor="remember-me" className="text-sm text-muted-foreground cursor-pointer">
              Remember me
            </label>
          </div>
          <Button
            type="button"
            variant="link"
            size="default"
            className="text-sm text-primary hover:underline h-11"
            data-testid="button-forgot-password"
          >
            Forgot password?
          </Button>
        </div>

        {/* Login Button */}
        <Button 
          type="submit" 
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={isLoading}
          data-testid="button-submit-login"
        >
          {isLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
          ) : (
            <LogIn className="mr-2 h-4 w-4" />
          )}
          {isLoading ? "Signing In..." : "Sign In"}
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-card text-muted-foreground">Or continue with</span>
          </div>
        </div>

        {/* Replit Auth Integration */}
        <Button 
          type="button" 
          variant="outline"
          className="w-full"
          onClick={handleReplitAuth}
          data-testid="button-replit-auth"
        >
          <Code className="mr-2 h-4 w-4" />
          Sign in with Replit
        </Button>
      </form>

      {/* Rate Limiting Notice */}
      <div className="mt-6 p-3 bg-muted rounded-lg">
        <p className="text-xs text-muted-foreground text-center">
          <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>
          Protected by rate limiting and security monitoring
        </p>
      </div>
    </Card>
  );
}
