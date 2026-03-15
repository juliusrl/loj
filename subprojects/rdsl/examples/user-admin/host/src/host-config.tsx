import React from 'react';
import {
  ReactDslHostProviders,
  ReactDslHostStatus,
  ReactDslHostToasts,
  resolveHostApiBase,
} from '@loj-lang/rdsl-host-react';
import type { AuthState, ToastMessage } from '@loj-lang/rdsl-runtime';

declare global {
  interface Window {
    __RDSL_API_BASE__?: string;
  }
}

const DEFAULT_AUTH: AuthState = {
  currentUser: {
    id: 'demo-admin',
    role: 'admin',
    name: 'Demo Admin',
    email: 'demo-admin@example.com',
  },
};

function formatMessage(message: ToastMessage): string {
  if (typeof message === 'string') {
    return message;
  }
  return message.defaultMessage ?? message.key;
}

export function HostProviders({ children }: { children?: React.ReactNode }) {
  const apiBase = React.useMemo(
    () => resolveHostApiBase(__RDSL_API_BASE__, typeof window !== 'undefined' ? window.__RDSL_API_BASE__ : undefined),
    [],
  );
  const generatedDir = React.useMemo(() => __RDSL_GENERATED_DIR__, []);

  return (
    <ReactDslHostProviders
      apiBase={apiBase}
      generatedDir={generatedDir}
      auth={DEFAULT_AUTH}
      formatMessage={formatMessage}
    >
      {children}
    </ReactDslHostProviders>
  );
}

export const HostStatus = ReactDslHostStatus;
export const HostToasts = ReactDslHostToasts;
