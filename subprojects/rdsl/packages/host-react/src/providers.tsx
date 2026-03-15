import React from 'react';
import {
  AuthProvider,
  ResourceProvider,
  ToastProvider,
  createFetchResourceClient,
  type AuthState,
  type ResourceClient,
  type ToastApi,
  type ToastMessage,
  resolveToastMessage,
} from '@loj-lang/rdsl-runtime';

export interface HostToastEntry {
  id: number;
  level: 'success' | 'error' | 'info';
  message: string;
}

export interface ReactDslHostProvidersProps {
  apiBase: string;
  generatedDir: string;
  auth: AuthState;
  resourceClient?: ResourceClient;
  toastDurationMs?: number;
  formatMessage?: (message: ToastMessage) => string;
  children?: React.ReactNode;
}

export interface HostRuntimeConfig {
  apiBase: string;
  generatedDir: string;
}

const HostRuntimeConfigContext = React.createContext<HostRuntimeConfig>({
  apiBase: '',
  generatedDir: '',
});

const HostToastContext = React.createContext<{
  toasts: HostToastEntry[];
  dismissToast: (id: number) => void;
}>({
  toasts: [],
  dismissToast: () => undefined,
});

let nextToastId = 1;

export function resolveHostApiBase(
  configuredApiBase: string,
  globalApiBase?: string | undefined,
): string {
  const explicit = configuredApiBase.trim();
  if (globalApiBase && globalApiBase.trim() !== '') {
    return globalApiBase;
  }
  return explicit;
}

function enqueueToast(
  setToasts: React.Dispatch<React.SetStateAction<HostToastEntry[]>>,
  level: HostToastEntry['level'],
  message: ToastMessage,
  durationMs: number,
  formatMessage: (message: ToastMessage) => string,
): void {
  const id = nextToastId;
  nextToastId += 1;
  setToasts((current: HostToastEntry[]) => [...current, { id, level, message: formatMessage(message) }]);
  window.setTimeout(() => {
    setToasts((current: HostToastEntry[]) => current.filter((toast: HostToastEntry) => toast.id !== id));
  }, durationMs);
}

export function ReactDslHostProviders({
  apiBase,
  generatedDir,
  auth,
  resourceClient,
  toastDurationMs = 3500,
  formatMessage = resolveToastMessage,
  children,
}: ReactDslHostProvidersProps) {
  const [toasts, setToasts] = React.useState<HostToastEntry[]>([]);
  const resolvedClient = React.useMemo(
    () => resourceClient ?? createFetchResourceClient({ baseUrl: apiBase }),
    [apiBase, resourceClient],
  );
  const toastApi = React.useMemo<ToastApi>(() => ({
    success(message) {
      enqueueToast(setToasts, 'success', message, toastDurationMs, formatMessage);
    },
    error(message) {
      enqueueToast(setToasts, 'error', message, toastDurationMs, formatMessage);
    },
    info(message) {
      enqueueToast(setToasts, 'info', message, toastDurationMs, formatMessage);
    },
  }), [formatMessage, toastDurationMs]);
  const dismissToast = React.useCallback((id: number) => {
    setToasts((current: HostToastEntry[]) => current.filter((toast: HostToastEntry) => toast.id !== id));
  }, []);

  return (
    <HostRuntimeConfigContext.Provider value={{ apiBase, generatedDir }}>
      <HostToastContext.Provider value={{ toasts, dismissToast }}>
        <AuthProvider value={auth}>
          <ToastProvider value={toastApi}>
            <ResourceProvider client={resolvedClient}>
              {children}
            </ResourceProvider>
          </ToastProvider>
        </AuthProvider>
      </HostToastContext.Provider>
    </HostRuntimeConfigContext.Provider>
  );
}

export function ReactDslHostStatus({ label = 'ReactDSL Host' }: { label?: string }) {
  const { apiBase, generatedDir } = React.useContext(HostRuntimeConfigContext);
  const storageKey = 'rdsl-host-status-collapsed';
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(storageKey) === '1');
    } catch {
      // localStorage is best-effort in the dev host
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // localStorage is best-effort in the dev host
      }
      return next;
    });
  }, []);

  return (
    <div className={`rdsl-host-status${collapsed ? ' rdsl-host-status-collapsed' : ''}`}>
      <div className="rdsl-host-status-main">
        <strong>{label}</strong>
        {!collapsed ? <span>generated: {generatedDir}</span> : null}
        {!collapsed ? <span>api: {apiBase}</span> : null}
      </div>
      <button
        type="button"
        className="rdsl-host-status-toggle"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand host status' : 'Collapse host status'}
        title={collapsed ? 'Expand host status' : 'Collapse host status'}
      >
        {collapsed ? '▤' : '–'}
      </button>
    </div>
  );
}

export function ReactDslHostToasts({ dismissLabel = 'Dismiss' }: { dismissLabel?: string }) {
  const { toasts, dismissToast } = React.useContext(HostToastContext);

  return (
    <div className="rdsl-host-toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`rdsl-host-toast rdsl-host-toast-${toast.level}`}>
          <div>{toast.message}</div>
          <button type="button" className="rdsl-host-toast-close" onClick={() => dismissToast(toast.id)}>
            {dismissLabel}
          </button>
        </div>
      ))}
    </div>
  );
}
