import { useState } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { RegistrationForm } from "@/components/auth/RegistrationForm";
import { PasswordResetForm } from "@/components/auth/PasswordResetForm";
import { EmailVerificationForm } from "@/components/auth/EmailVerificationForm";
import { ReplitAuthBanner } from "@/components/auth/ReplitAuthBanner";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { GraduationCap, Shield, Moon, Sun } from "lucide-react";

type AuthTab = 'login' | 'register' | 'reset' | 'verify';

export default function Auth() {
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('dark');
  };

  const renderActiveForm = () => {
    switch (activeTab) {
      case 'login':
        return <LoginForm />;
      case 'register':
        return <RegistrationForm />;
      case 'reset':
        return <PasswordResetForm />;
      case 'verify':
        return <EmailVerificationForm />;
      default:
        return <LoginForm />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Replit Auth Banner */}
      <ReplitAuthBanner />
      
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
              <div className="security-badge px-3 py-1 rounded-full text-white text-xs font-medium">
                <Shield className="mr-1 w-3 h-3 inline" />
                SSL Secured
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleTheme}
                className="p-2"
                data-testid="button-theme-toggle"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Authentication Container */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-4xl w-full">
          
          {/* Authentication Tabs */}
          <div className="mb-8">
            <div className="flex justify-center">
              <div className="flex bg-muted p-1 rounded-lg">
                <Button
                  variant={activeTab === 'login' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('login')}
                  className="px-6 py-2 text-sm font-medium rounded-md"
                  data-testid="tab-login"
                >
                  Sign In
                </Button>
                <Button
                  variant={activeTab === 'register' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('register')}
                  className="px-6 py-2 text-sm font-medium rounded-md"
                  data-testid="tab-register"
                >
                  Create Account
                </Button>
                <Button
                  variant={activeTab === 'reset' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('reset')}
                  className="px-6 py-2 text-sm font-medium rounded-md"
                  data-testid="tab-reset"
                >
                  Reset Password
                </Button>
                <Button
                  variant={activeTab === 'verify' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveTab('verify')}
                  className="px-6 py-2 text-sm font-medium rounded-md"
                  data-testid="tab-verify"
                >
                  Verify Email
                </Button>
              </div>
            </div>
          </div>

          {/* Active Form */}
          {renderActiveForm()}
        </div>
      </div>

      {/* Footer */}
      <Footer variant="minimal" />
    </div>
  );
}
