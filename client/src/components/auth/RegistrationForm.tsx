import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FloatingLabelInput } from "@/components/ui/floating-label-input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Eye, EyeOff, GraduationCap, UserCheck, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type UserRole = 'student' | 'reviewer' | 'admin';

export function RegistrationForm() {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "student" as UserRole,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptMarketing, setAcceptMarketing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const getPasswordStrength = (password: string): number => {
    let strength = 0;
    if (password.length >= 8) strength += 25;
    if (/[A-Z]/.test(password)) strength += 25;
    if (/[a-z]/.test(password)) strength += 25;
    if (/[0-9!@#$%^&*]/.test(password)) strength += 25;
    return strength;
  };

  const passwordStrength = getPasswordStrength(formData.password);
  const getStrengthLabel = (strength: number): string => {
    if (strength < 25) return "Weak";
    if (strength < 50) return "Fair";
    if (strength < 75) return "Good";
    return "Strong";
  };

  const getStrengthColor = (strength: number): string => {
    if (strength < 25) return "bg-destructive";
    if (strength < 50) return "bg-yellow-500";
    if (strength < 75) return "bg-blue-500";
    return "bg-green-500";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (!acceptTerms) {
      toast({
        title: "Terms required",
        description: "Please accept the terms of service to continue.",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please ensure both password fields match.",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    if (passwordStrength < 50) {
      toast({
        title: "Password too weak",
        description: "Please choose a stronger password.",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    try {
      toast({
        title: "Registration successful",
        description: "Please check your email to verify your account.",
      });
    } catch (error) {
      toast({
        title: "Registration failed",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: keyof typeof formData) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'student':
        return <GraduationCap className="text-lg mb-1" />;
      case 'reviewer':
        return <UserCheck className="text-lg mb-1" />;
      case 'admin':
        return <Shield className="text-lg mb-1" />;
    }
  };

  return (
    <Card className="auth-card rounded-xl shadow-2xl p-8 max-w-md mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Create Account</h2>
        <p className="text-muted-foreground">Join ScholarshipAI and discover opportunities</p>
      </div>

      {/* Progress Indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>Account Details</span>
          <span>1 of 2</span>
        </div>
        <Progress value={50} className="h-2" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name Fields */}
        <div className="grid grid-cols-2 gap-4">
          <FloatingLabelInput
            type="text"
            id="register-firstname"
            label="First name"
            value={formData.firstName}
            onChange={handleInputChange('firstName')}
            required
            data-testid="input-firstname"
          />
          <FloatingLabelInput
            type="text"
            id="register-lastname"
            label="Last name"
            value={formData.lastName}
            onChange={handleInputChange('lastName')}
            required
            data-testid="input-lastname"
          />
        </div>

        {/* Email Input */}
        <FloatingLabelInput
          type="email"
          id="register-email"
          label="Email address"
          value={formData.email}
          onChange={handleInputChange('email')}
          required
          data-testid="input-email"
        />

        {/* Role Selection */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Account Type</label>
          <div className="grid grid-cols-3 gap-2">
            {(['student', 'reviewer', 'admin'] as UserRole[]).map((role) => (
              <label key={role} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="role"
                  value={role}
                  checked={formData.role === role}
                  onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as UserRole }))}
                  className="sr-only"
                  data-testid={`radio-role-${role}`}
                />
                <div className={cn(
                  "role-option border-2 p-3 rounded-lg text-center transition-all",
                  formData.role === role
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary"
                )}>
                  {getRoleIcon(role)}
                  <div className="text-xs font-medium">
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Password Fields */}
        <div className="space-y-4">
          <div className="relative">
            <FloatingLabelInput
              type={showPassword ? "text" : "password"}
              id="register-password"
              label="Password"
              value={formData.password}
              onChange={handleInputChange('password')}
              required
              data-testid="input-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowPassword(!showPassword)}
              data-testid="button-toggle-password"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          {/* Password Strength Indicator */}
          {formData.password && (
            <div className="space-y-2">
              <div className="flex space-x-1">
                {[25, 50, 75, 100].map((threshold) => (
                  <div
                    key={threshold}
                    className={cn(
                      "h-1 w-full rounded",
                      passwordStrength >= threshold ? getStrengthColor(passwordStrength) : "bg-muted"
                    )}
                  />
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Password strength: <span className={cn(
                  passwordStrength < 25 ? "text-destructive" :
                  passwordStrength < 50 ? "text-yellow-500" :
                  passwordStrength < 75 ? "text-blue-500" : "text-green-500"
                )}>{getStrengthLabel(passwordStrength)}</span>
              </div>
            </div>
          )}

          <div className="relative">
            <FloatingLabelInput
              type={showConfirmPassword ? "text" : "password"}
              id="register-confirm-password"
              label="Confirm password"
              value={formData.confirmPassword}
              onChange={handleInputChange('confirmPassword')}
              required
              data-testid="input-confirm-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              data-testid="button-toggle-confirm-password"
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Terms & Privacy */}
        <div className="space-y-3">
          <div className="flex items-start space-x-2">
            <Checkbox
              id="accept-terms"
              checked={acceptTerms}
              onCheckedChange={(checked) => setAcceptTerms(checked === true)}
              className="mt-0.5"
              data-testid="checkbox-accept-terms"
            />
            <label htmlFor="accept-terms" className="text-sm text-muted-foreground cursor-pointer">
              I agree to the <Link href="/terms"><a target="_blank" className="text-primary hover:underline" data-testid="link-terms">Terms of Service</a></Link> and <Link href="/privacy"><a target="_blank" className="text-primary hover:underline" data-testid="link-privacy">Privacy Policy</a></Link>
            </label>
          </div>
          <div className="flex items-start space-x-2">
            <Checkbox
              id="accept-marketing"
              checked={acceptMarketing}
              onCheckedChange={(checked) => setAcceptMarketing(checked === true)}
              className="mt-0.5"
              data-testid="checkbox-accept-marketing"
            />
            <label htmlFor="accept-marketing" className="text-sm text-muted-foreground cursor-pointer">
              Send me scholarship notifications and updates
            </label>
          </div>
        </div>

        {/* Register Button */}
        <Button 
          type="submit" 
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={isLoading}
          data-testid="button-submit-register"
        >
          {isLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
          ) : (
            <UserPlus className="mr-2 h-4 w-4" />
          )}
          {isLoading ? "Creating Account..." : "Create Account"}
        </Button>
      </form>
    </Card>
  );
}
