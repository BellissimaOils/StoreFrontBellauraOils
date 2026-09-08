import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

const clerkPubKey = (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY;
const isClerkKeyValid = clerkPubKey && clerkPubKey.startsWith('pk_');

interface ClerkAuthContextType {
  isSignedIn: boolean;
  user: any;
  isLoaded: boolean;
  session: any;
  clerk: any;
}

const defaultClerkValue: ClerkAuthContextType = {
  isSignedIn: false,
  user: null,
  isLoaded: !isClerkKeyValid,
  session: null,
  clerk: { signOut: async () => {}, openSignIn: () => {} },
};

const ClerkAuthContext = createContext<ClerkAuthContextType>(defaultClerkValue);

function ClerkBridge({ children, ClerkModule }: { children: React.ReactNode; ClerkModule: any }) {
  const user = ClerkModule.useUser();
  const session = ClerkModule.useSession();
  const clerk = ClerkModule.useClerk();

  const value = useMemo(() => ({
    isSignedIn: Boolean(user?.isSignedIn),
    user: user?.user ?? null,
    isLoaded: Boolean(user?.isLoaded),
    session: session?.session ?? null,
    clerk: clerk ?? { signOut: async () => {}, openSignIn: () => {} },
  }), [user?.isSignedIn, user?.user, user?.isLoaded, session?.session, clerk]);

  return (
    <ClerkAuthContext.Provider value={value}>
      {children}
    </ClerkAuthContext.Provider>
  );
}

export const ClerkProvider = ({ children }: { children: React.ReactNode }) => {
  const [clerkModule, setClerkModule] = useState<any>(null);

  useEffect(() => {
    if (isClerkKeyValid) {
      import('@clerk/react')
        .then((mod) => {
          setClerkModule(mod);
        })
        .catch((err) => {
          console.warn('Failed to load Clerk module:', err);
        });
    }
  }, []);

  if (isClerkKeyValid && clerkModule) {
    const OriginalClerkProvider = clerkModule.ClerkProvider;
    return (
      <OriginalClerkProvider publishableKey={clerkPubKey} afterSignOutUrl="/">
        <ClerkBridge ClerkModule={clerkModule}>
          {children}
        </ClerkBridge>
      </OriginalClerkProvider>
    );
  }

  return (
    <ClerkAuthContext.Provider value={defaultClerkValue}>
      {children}
    </ClerkAuthContext.Provider>
  );
};

export const useUser = () => {
  const ctx = useContext(ClerkAuthContext);
  return {
    isSignedIn: ctx.isSignedIn,
    user: ctx.user,
    isLoaded: ctx.isLoaded,
  };
};

export const useSession = () => {
  const ctx = useContext(ClerkAuthContext);
  return {
    session: ctx.session,
    isLoaded: ctx.isLoaded,
  };
};

export const useClerk = () => {
  const ctx = useContext(ClerkAuthContext);
  return ctx.clerk;
};

const LazyUserButton = React.lazy(async () => {
  const mod = await import('@clerk/react');
  return { default: mod.UserButton };
});

export const UserButton = (props: any) => {
  if (!isClerkKeyValid) return null;
  return (
    <React.Suspense fallback={null}>
      <LazyUserButton {...props} />
    </React.Suspense>
  );
};

const LazySignIn = React.lazy(async () => {
  const mod = await import('@clerk/react');
  return { default: mod.SignIn };
});

export const SignIn = (props: any) => {
  if (!isClerkKeyValid) return <div>Please configure Clerk to sign in.</div>;
  return (
    <React.Suspense fallback={<div className="p-4 text-center text-sm text-primary-earth/50">Loading sign in...</div>}>
      <LazySignIn {...props} />
    </React.Suspense>
  );
};

