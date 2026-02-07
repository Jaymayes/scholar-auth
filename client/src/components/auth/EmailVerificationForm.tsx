import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, RotateCcw, Mail } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { isUnauthorizedError } from "@/lib/auth-utils";

export function EmailVerificationForm() {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Timer countdown
  useEffect(() => {
    if (timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [timeLeft]);

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const handleInputChange = (index: number, value: string) => {
    if (value.length > 1) return; // Only allow single digits

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const verificationCode = code.join('');
    
    if (verificationCode.length !== 6) {
      toast({
        title: "Invalid code",
        description: "Please enter the complete 6-digit verification code.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/verify-email", { code: verificationCode });
      toast({
        title: "Email verified",
        description: "Your email has been successfully verified!",
      });
      // Redirect to home or refresh user data
      window.location.href = "/";
    } catch (error) {
      if (isUnauthorizedError(error as Error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Verification failed",
        description: "Invalid or expired code. Please try again.",
        variant: "destructive",
      });
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);

    try {
      await apiRequest("POST", "/api/auth/send-verification");
      toast({
        title: "Code sent",
        description: "A new verification code has been sent to your email.",
      });
      setTimeLeft(300);
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (error) {
      if (isUnauthorizedError(error as Error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Failed to resend code",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Card className="auth-card rounded-xl shadow-2xl p-8 max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Mail className="text-warning" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Verify Your Email</h2>
        <p className="text-muted-foreground">Enter the 6-digit code sent to your email</p>
        {user?.email && (
          <p className="text-sm text-primary font-medium mt-2">{user.email}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Verification Code Input */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Verification Code</label>
          <div className="flex space-x-2 justify-center">
            {code.map((digit, index) => (
              <Input
                key={index}
                ref={(el) => (inputRefs.current[index] = el)}
                type="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleInputChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-12 h-12 text-center text-lg font-bold"
                data-testid={`input-code-${index}`}
              />
            ))}
          </div>
        </div>

        {/* Timer */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Code expires in{" "}
            <span className={`font-medium ${timeLeft < 60 ? 'text-destructive' : 'text-warning'}`}>
              {formatTime(timeLeft)}
            </span>
          </p>
        </div>

        {/* Verify Button */}
        <Button 
          type="submit" 
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={isLoading || code.join('').length !== 6}
          data-testid="button-verify-email"
        >
          {isLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
          ) : (
            <CheckCircle className="mr-2 h-4 w-4" />
          )}
          {isLoading ? "Verifying..." : "Verify Email"}
        </Button>

        {/* Resend Code */}
        <Button 
          type="button" 
          variant="outline"
          className="w-full"
          onClick={handleResendCode}
          disabled={isResending || timeLeft > 240} // Allow resend after 1 minute
          data-testid="button-resend-code"
        >
          {isResending ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-border mr-2"></div>
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          {isResending ? "Sending..." : "Resend Code"}
        </Button>
      </form>

      {/* Alternative Verification */}
      <div className="mt-6 p-4 bg-muted rounded-lg">
        <p className="text-xs text-muted-foreground text-center mb-2">
          Didn't receive the code?
        </p>
        <Button 
          variant="ghost"
          size="sm"
          className="w-full text-sm text-primary hover:underline"
          data-testid="button-alternative-verification"
        >
          Try alternative verification methods
        </Button>
      </div>
    </Card>
  );
}
