import { useEffect } from 'react';
import { useAuth } from './use-auth';

const A5_STUDENT_PORTAL = 'https://student-pilot-jamarrlmayes.replit.app/dashboard';
const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '').split(',').map((e: string) => e.trim().toLowerCase());

export function useNonAdminRedirect() {
  const { user, isAuthenticated, isLoading } = useAuth();
  
  useEffect(() => {
    if (isLoading) return;
    
    if (isAuthenticated && user) {
      const userEmail = user.email?.toLowerCase() || '';
      const isAdmin = user.role === 'admin' || ADMIN_EMAILS.includes(userEmail);
      
      if (!isAdmin) {
        console.log('🔄 Non-admin user detected, redirecting to A5 Student Portal');
        window.location.href = A5_STUDENT_PORTAL;
      }
    }
  }, [isAuthenticated, user, isLoading]);
  
  return {
    isAdmin: user?.role === 'admin' || ADMIN_EMAILS.includes(user?.email?.toLowerCase() || ''),
    isChecking: isLoading
  };
}
