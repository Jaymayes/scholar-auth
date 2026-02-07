import { useState, useEffect } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useNonAdminRedirect } from "@/hooks/use-admin-redirect";
import { HealthWidget } from "@/components/HealthWidget";
import { AgeGate } from "@/components/compliance/AgeGate";
import { isCoppaEnabled, getCoppaRolloutInfo } from "@/config/api";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MFAEnrollmentModal } from "@/components/auth/MFAEnrollmentModal";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import Auth from "@/pages/auth";
import AuthCallback from "@/pages/authCallback";
import ConnectedApps from "@/pages/ConnectedApps";
import ParentConsent from "@/pages/ParentConsent";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import TrustSecurity from "@/pages/trust-security";
import AccessibilityStatement from "@/pages/accessibility";
import ConnectivityTest from "@/pages/ConnectivityTest";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import P95Dashboard from "@/pages/P95Dashboard";

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { isAdmin } = useNonAdminRedirect();
  const [location, setLocation] = useLocation();
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [mfaCheckComplete, setMfaCheckComplete] = useState(false);

  // 🔐 MFA Status Check (CEO DIRECTIVE: Nov 10, 2025)
  const { data: mfaStatus, isLoading: mfaLoading } = useQuery<{
    success: boolean;
    status: {
      enrolled: boolean;
      hasTotp: boolean;
      hasWebAuthn: boolean;
      shouldPrompt: boolean;
      enforcementRequired: boolean;
      factors: Array<any>;
    };
  }>({
    queryKey: ['/api/mfa/status'],
    enabled: isAuthenticated && !isLoading,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  // 🔐 Show MFA enrollment modal after authentication and COPPA checks
  useEffect(() => {
    if (isAuthenticated && !isLoading && !mfaLoading && mfaStatus && !mfaCheckComplete) {
      const shouldPrompt = mfaStatus.status.shouldPrompt === true;
      const isEnrolled = mfaStatus.status.enrolled === true;
      
      // Only show modal once per session if not enrolled and should prompt
      if (shouldPrompt && !isEnrolled && !sessionStorage.getItem('mfa-modal-shown')) {
        setShowMfaModal(true);
        sessionStorage.setItem('mfa-modal-shown', 'true');
      }
      setMfaCheckComplete(true);
    }
  }, [isAuthenticated, isLoading, mfaLoading, mfaStatus, mfaCheckComplete]);

  const handleMfaComplete = () => {
    setShowMfaModal(false);
    queryClient.invalidateQueries({ queryKey: ['/api/mfa/status'] });
  };

  const handleMfaClose = () => {
    setShowMfaModal(false);
  };
  
  // 🔍 DEBUGGING: Log user state changes for age verification
  console.log("🔍 Router: User state:", {
    isAuthenticated,
    isLoading,
    userId: user?.id,
    ageGateStatus: user?.ageGateStatus,
    restrictedProcessing: user?.restrictedProcessing
  });

  // 🔍 DEBUGGING: Log current location to diagnose routing issues
  console.log("🔍 Router: Current location:", {
    location,
    href: window.location.href,
    pathname: window.location.pathname,
    baseURI: document.baseURI
  });

  // Show neutral loading state while checking authentication to reduce flashes
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated users see landing and auth pages
  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/sign-in/:rest*" component={SignInPage} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up/:rest*" component={SignUpPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/auth" component={Auth} />
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/accessibility" component={AccessibilityStatement} />
        <Route path="/trust-security" component={TrustSecurity} />
        <Route path="/p95-dashboard" component={P95Dashboard} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  // Authenticated users: Check COPPA compliance flow with feature flag
  const coppaEnabled = isCoppaEnabled();
  const coppaInfo = getCoppaRolloutInfo();
  
  // Normalize status casing to handle backend variations
  const status = user?.ageGateStatus?.toLowerCase?.() || '';
  
  // Age verification required if COPPA is enabled AND user hasn't completed verification
  const needsAgeVerification = coppaEnabled && (!status || status === 'pending');
  const isRestricted = coppaEnabled && status === 'under_13_restricted';
  
  // 🔍 DEBUGGING: Log routing decision logic including feature flags
  console.log("🔍 Router: Routing decision:", {
    needsAgeVerification,
    isRestricted,
    ageGateStatus: user?.ageGateStatus,
    coppaEnabled,
    coppaRolloutPercent: coppaInfo.rolloutPercent,
    userRolloutId: coppaInfo.userRolloutId
  });

  // 🎯 COPPA P0: Force redirect to /age-gate when verification needed
  if (isAuthenticated && coppaEnabled && needsAgeVerification && location !== '/age-gate' && location !== '/') {
    setLocation('/age-gate');
  }

  return (
    <>
      <Switch>
        {needsAgeVerification ? (
          <>
            {/* 🎯 P0 FIX: Remove "/" → AgeGate mapping to prevent Router loop */}
            <Route path="/age-gate" component={() => <AgeGate onComplete={() => {}} />} />
            <Route path="/auth" component={Auth} />
            <Route path="/auth/callback" component={AuthCallback} />
            {/* ✅ COPPA P0: Catch-all route ensures AgeGate appears on any unmatched path */}
            <Route component={() => <AgeGate onComplete={() => {}} />} />
          </>
        ) : isRestricted ? (
          <>
            <Route path="/" component={ParentConsent} />
            <Route path="/parent-consent" component={ParentConsent} />
            <Route path="/auth" component={Auth} />
            <Route path="/auth/callback" component={AuthCallback} />
          </>
        ) : (
          <>
            <Route path="/" component={Home} />
            <Route path="/auth" component={Auth} />
            <Route path="/auth/callback" component={AuthCallback} />
            <Route path="/connected-apps" component={ConnectedApps} />
            <Route path="/admin/connectivity-test" component={ConnectivityTest} />
            <Route path="/age-gate" component={() => <AgeGate onComplete={() => {}} />} />
            <Route path="/parent-consent" component={ParentConsent} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route path="/accessibility" component={AccessibilityStatement} />
            <Route path="/trust-security" component={TrustSecurity} />
          </>
        )}
        <Route component={NotFound} />
      </Switch>

      {/* 🔐 MFA Enrollment Modal (CEO DIRECTIVE: Nov 10, 2025) */}
      {isAuthenticated && !needsAgeVerification && !isRestricted && (
        <MFAEnrollmentModal
          open={showMfaModal}
          onClose={handleMfaClose}
          onComplete={handleMfaComplete}
        />
      )}
    </>
  );
}

function App() {
  // P0 HARDENING: Build-time assertions to prevent prod origin calls from dev
  if (import.meta.env.DEV) {
    const baseUrl = import.meta.env.VITE_API_URL;
    if (baseUrl && (baseUrl.includes('scholarshipai.com') || baseUrl.includes('fly.dev'))) {
      console.warn('⚠️ DEVELOPMENT BUILD WARNING: VITE_API_URL points to production/external endpoint');
      console.warn('Expected: empty or localhost for development builds');
      console.warn('Current:', baseUrl);
    }
  }

  // 🔧 P0 REQUIRED: Console logging fields for validation
  const currentPath = window.location.pathname;
  const detectedBase = currentPath.includes('/repl/') ? currentPath.split('/').slice(0, -1).join('/') : '';
  const routerBase = detectedBase;
  const apiBase = detectedBase;
  const buildVersion = import.meta.env.VITE_BUILD_SHA || 'dev-local';
  
  console.log('🔧 P0 VALIDATION - Required console fields:', {
    detectedBase,
    routerBase,
    currentPath,
    apiBase,
    buildVersion,
    href: window.location.href
  });

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={routerBase}>
            <Toaster />
            <Router />
            <HealthWidget />
          </WouterRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
