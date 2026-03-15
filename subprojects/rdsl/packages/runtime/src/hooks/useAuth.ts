import React from 'react';

export interface AuthUser {
  id?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuthState {
  currentUser: AuthUser | null;
}

interface AuthProviderProps {
  value: AuthState;
  children?: React.ReactNode;
}

const AuthContext = React.createContext<AuthState | undefined>(undefined);

function readGlobalAuth(): AuthState {
  if (typeof window === 'undefined') {
    return { currentUser: null };
  }
  const value = (window as unknown as { __RDSL_AUTH__?: AuthState }).__RDSL_AUTH__;
  if (value && typeof value === 'object') {
    return {
      currentUser: value.currentUser ?? null,
    };
  }
  return { currentUser: null };
}

export function AuthProvider({ value, children }: AuthProviderProps) {
  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  return React.useContext(AuthContext) ?? readGlobalAuth();
}
