import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";

export function useAuth() {
  const { isLoaded, isSignedIn, userId } = useClerkAuth();
  const { user: clerkUser } = useUser();
  
  // Fetch user data from our backend (synced from Clerk)
  const { data: user, isLoading: isUserLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 5000,
    enabled: isSignedIn === true, // Only fetch when signed in
  });

  return {
    user: user || (clerkUser ? {
      id: clerkUser.id,
      email: clerkUser.emailAddresses?.[0]?.emailAddress || null,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      profileImageUrl: clerkUser.imageUrl,
      role: 'student' as const,
      isEmailVerified: clerkUser.emailAddresses?.[0]?.verification?.status === 'verified',
    } : null) as User | null,
    isLoading: !isLoaded || (isSignedIn && isUserLoading),
    isSuccess: isLoaded,
    isAuthenticated: isSignedIn === true,
    clerkUser,
  };
}
