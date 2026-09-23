import React, { createContext, useContext } from "react";
import { ClerkProvider, useClerk, useUser } from "@clerk/react";

export const CLERK_PUBLISHABLE_KEY =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY) ||
  "";

const ClerkAvailableContext = createContext<boolean>(false);

function InnerAvailabilityProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClerkAvailableContext.Provider value={true}>
      {children}
    </ClerkAvailableContext.Provider>
  );
}

export function AmberClerkProvider({ children }: { children: React.ReactNode }) {
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <ClerkAvailableContext.Provider value={false}>
        {children}
      </ClerkAvailableContext.Provider>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <InnerAvailabilityProvider>{children}</InnerAvailabilityProvider>
    </ClerkProvider>
  );
}

export function useIsClerkAvailable(): boolean {
  return useContext(ClerkAvailableContext);
}

export function useClerkAuth() {
  const isAvailable = useIsClerkAvailable();

  if (!isAvailable) {
    return {
      isAvailable: false,
      user: null,
      signInWithGoogle: async () => {
        throw new Error(
          "Clerk is not configured. Please add VITE_CLERK_PUBLISHABLE_KEY to your .env file."
        );
      },
      signOut: async () => {},
    };
  }

  return useClerkAuthInternal();
}

function useClerkAuthInternal() {
  const clerk = useClerk();
  const { user } = useUser();

  const signInWithGoogle = async () => {
    const redirectUrl = typeof window !== "undefined" ? window.location.origin : "/";
    const clerkAny = clerk as unknown as {
      authenticateWithRedirect?: (opts: unknown) => Promise<unknown>;
      openSignIn?: (opts?: unknown) => unknown;
      redirectToSignIn?: (opts?: unknown) => Promise<unknown>;
    };

    if (typeof clerkAny.authenticateWithRedirect === "function") {
      await clerkAny.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl,
        redirectUrlComplete: redirectUrl,
      });
    } else if (typeof clerkAny.openSignIn === "function") {
      clerkAny.openSignIn();
    } else if (typeof clerkAny.redirectToSignIn === "function") {
      await clerkAny.redirectToSignIn({
        signInFallbackRedirectUrl: redirectUrl,
        signInForceRedirectUrl: redirectUrl,
      });
    }
  };

  const signOut = async () => {
    await clerk.signOut();
  };

  return {
    isAvailable: true,
    user,
    signInWithGoogle,
    signOut,
  };
}
