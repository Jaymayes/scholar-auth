import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { useToast } from "@/hooks/use-toast";
import { Send, ArrowLeft, Key, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export function PasswordResetForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/request-password-reset", { email });
      setIsEmailSent(true);
      toast({
        title: "Reset link sent",
        description: "Check your email for password reset instructions.",
      });
    } catch (error) {
      toast({
        title: "Request failed",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToSignIn = () => {
    // This would typically navigate back to the login tab
    window.location.reload();
  };

  return (
    <Card className="auth-card rounded-xl shadow-2xl p-8 max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Key className="text-primary" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Reset Password</h2>
        <p className="text-muted-foreground">
          {isEmailSent 
            ? "Check your email for reset instructions" 
            : "Enter your email to receive reset instructions"
          }
        </p>
      </div>

      {!isEmailSent ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Email Input */}
          <FloatingLabelInput
            type="email"
            id="reset-email"
            label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="input-reset-email"
          />

          {/* Security Info */}
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <Info className="text-primary mt-0.5 flex-shrink-0" size={16} />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Security Notice</p>
                <p>Reset links expire in 15 minutes for security. Check your spam folder if you don't receive the email.</p>
              </div>
            </div>
          </div>

          {/* Send Reset Button */}
          <Button 
            type="submit" 
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={isLoading}
            data-testid="button-send-reset"
          >
            {isLoading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {isLoading ? "Sending..." : "Send Reset Link"}
          </Button>

          {/* Back to Sign In */}
          <Button 
            type="button" 
            variant="outline"
            className="w-full"
            onClick={handleBackToSignIn}
            data-testid="button-back-to-signin"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sign In
          </Button>
        </form>
      ) : (
        <div className="space-y-6">
          {/* Success Message */}
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto">
              <Send className="text-green-600 dark:text-green-400" size={24} />
            </div>
            <p className="text-muted-foreground">
              We've sent password reset instructions to <strong className="text-foreground">{email}</strong>
            </p>
          </div>

          {/* Instructions */}
          <div className="bg-muted p-4 rounded-lg">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>• Check your email inbox and spam folder</p>
              <p>• Click the reset link within 15 minutes</p>
              <p>• Follow the instructions to create a new password</p>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <Button 
              type="button" 
              variant="outline"
              className="w-full"
              onClick={() => setIsEmailSent(false)}
              data-testid="button-resend-email"
            >
              <Send className="mr-2 h-4 w-4" />
              Send to Different Email
            </Button>
            <Button 
              type="button" 
              variant="ghost"
              className="w-full"
              onClick={handleBackToSignIn}
              data-testid="button-back-to-signin-success"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sign In
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
