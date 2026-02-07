import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Shield, Calendar, AlertTriangle } from "lucide-react";

interface AgeGateProps {
  onComplete: (isUnder13: boolean) => void;
}

export function AgeGate({ onComplete }: AgeGateProps) {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [validationError, setValidationError] = useState<string>("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();

  // 🔐 P0 FIX: Redirect to login if user is not authenticated (no toast on initial redirect)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      console.log("🔐 AgeGate: User not authenticated, redirecting to sign-in");
      // Clear any stale user state
      queryClient.setQueryData(['/api/auth/user'], null);
      setLocation('/sign-in');
    }
  }, [isAuthenticated, isLoading, setLocation]);

  // Age calculation now handled server-side for security
  
  // 🔐 GUARD: Don't render form if not authenticated (prevents form flash)
  if (!isLoading && !isAuthenticated) {
    return null; // Return null to avoid rendering while redirect happens
  }

  const submitAgeMutation = useMutation({
    mutationFn: async (dateOfBirth: string) => {
      console.log("🔍 AgeGate: API call starting for dateOfBirth:", dateOfBirth);
      const response = await apiRequest("POST", "/api/auth/update-age-status", { dateOfBirth });
      console.log("✅ AgeGate: API response received:", response);
      return response;
    },
    onSuccess: async (response: any) => {
      console.log("🎉 AgeGate: onSuccess callback triggered with response:", response);
      const { requiresParentalConsent, ageGateStatus } = response;
      
      // 🎯 P0 FIX: Immediately update cache with correct status (lowercase)
      const finalStatus = requiresParentalConsent ? 'under_13_restricted' : 'over_13_verified';
      console.log("🔄 AgeGate: Setting user cache with status:", finalStatus);
      queryClient.setQueryData(['/api/auth/user'], (prev: any) => 
        prev ? { 
          ...prev, 
          ageGateStatus: finalStatus, 
          restrictedProcessing: requiresParentalConsent 
        } : prev
      );
      
      // 🎯 P0 FIX: Use refetchQueries to ensure state is fresh before navigation
      console.log("🔄 AgeGate: Refetching user query to ensure fresh state...");
      await queryClient.refetchQueries({ queryKey: ['/api/auth/user'], type: 'active' });
      console.log("✅ AgeGate: User state refetch completed");
      
      // Show toast first
      if (requiresParentalConsent) {
        console.log("🚨 AgeGate: Under 13 - showing parental consent toast");
        toast({
          title: "Parental Consent Required",
          description: "Your account is restricted until parental consent is verified.",
          variant: "default",
        });
      } else {
        console.log("✨ AgeGate: Over 13 - showing success toast");
        toast({
          title: "Age Verification Complete", 
          description: "Welcome! You can now access all features.",
          variant: "default",
        });
      }
      
      // 🎯 P0 FIX: Navigate immediately after refetch (no setTimeout race condition)
      if (requiresParentalConsent) {
        console.log("🧭 AgeGate: Navigating to /parent-consent");
        setLocation('/parent-consent');
      } else {
        console.log("🧭 AgeGate: Navigating to home after successful verification");
        setLocation('/'); // Navigate to home - Router guard will allow access since needsAgeVerification = false
      }
      
      // Call onComplete callback for any parent handling
      onComplete(requiresParentalConsent);
    },
    onError: (error: any) => {
      console.log("❌ AgeGate: onError callback triggered with error:", error);
      
      // Check if this is an authentication error (401 Unauthorized)
      // apiRequest throws errors in format "STATUS: message" e.g. "401: Unauthorized"
      const errorMessage = error?.message || String(error);
      const is401Error = errorMessage.startsWith('401') || 
                         errorMessage.includes('401:') || 
                         errorMessage.toLowerCase().includes('unauthorized') ||
                         errorMessage.toLowerCase().includes('session');
      
      if (is401Error) {
        console.log("🔐 AgeGate: Session expired or unauthorized - redirecting to login");
        toast({
          title: "Session Expired",
          description: "Please sign in again to verify your age.",
          variant: "destructive",
        });
        // Clear cached user state and redirect to login
        queryClient.setQueryData(['/api/auth/user'], null);
        queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
        setLocation('/sign-in');
        return;
      }
      
      // Check for network errors
      if (errorMessage.toLowerCase().includes('network') || 
          errorMessage.toLowerCase().includes('fetch')) {
        toast({
          title: "Connection Error",
          description: "Unable to connect to the server. Please check your internet connection.",
          variant: "destructive",
        });
        return;
      }
      
      toast({
        title: "Verification Failed",
        description: "Unable to process age verification. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    console.log("🎯 AgeGate: handleSubmit start - form submission triggered");
    e.preventDefault();
    
    // Clear any previous validation errors
    setValidationError("");
    
    if (!dateOfBirth) {
      const errorMsg = "Please enter your date of birth to continue.";
      setValidationError(errorMsg);
      toast({
        title: "Date Required",
        description: errorMsg,
        variant: "destructive",
      });
      return;
    }

    // Validate date format client-side (server does final validation)
    const birthDate = new Date(dateOfBirth);
    if (isNaN(birthDate.getTime()) || birthDate > new Date()) {
      const errorMsg = "Please enter a valid date of birth.";
      setValidationError(errorMsg);
      toast({
        title: "Invalid Date",
        description: errorMsg,
        variant: "destructive",
      });
      return;
    }

    // Send only dateOfBirth - server calculates age securely
    submitAgeMutation.mutate(dateOfBirth);
  };

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Verifying session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
            <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Age Verification</CardTitle>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            We need to verify your age to provide appropriate services and comply with privacy regulations.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" aria-hidden="true" />
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => {
                    setDateOfBirth(e.target.value);
                    // Clear validation error when user starts typing
                    if (validationError) setValidationError("");
                  }}
                  className={`pl-10 ${validationError ? 'border-red-500 focus:border-red-500' : ''}`}
                  max={new Date().toISOString().split('T')[0]}
                  required
                  aria-invalid={validationError ? 'true' : 'false'}
                  aria-describedby={`dateOfBirth-hint ${validationError ? 'dateOfBirth-error' : ''}`.trim()}
                  data-testid="input-date-of-birth"
                />
              </div>
              {validationError && (
                <div 
                  id="dateOfBirth-error" 
                  className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1"
                  role="alert"
                >
                  <AlertTriangle className="w-3 h-3" />
                  {validationError}
                </div>
              )}
            </div>

            <div 
              id="dateOfBirth-hint"
              className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3"
              role="note"
              aria-label="Privacy protection information"
            >
              <div className="flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <div className="text-sm text-amber-700 dark:text-amber-300">
                  <p className="font-medium">Privacy Protection</p>
                  <p className="text-xs mt-1">
                    If you're under 13, we'll need parental consent before you can use our services, 
                    in compliance with COPPA regulations.
                  </p>
                </div>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={submitAgeMutation.isPending}
              data-testid="button-verify-age"
            >
              {submitAgeMutation.isPending ? "Verifying..." : "Verify Age"}
            </Button>
          </form>

          {/* Screen reader status announcements */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {submitAgeMutation.isPending && "Processing age verification..."}
          </div>
          
          <div className="text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Your date of birth is used solely for age verification and compliance purposes.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}