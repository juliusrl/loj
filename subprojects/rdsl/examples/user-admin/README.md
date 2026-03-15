# User Admin Example

This example now covers three layers:

- `app.web.loj`: the recommended source DSL program
- `app.rdsl`: legacy alias of the same frontend-family source
- `generated/`: local compiled source tree emitted by `rdsl build` (not checked in)
- `mock-server.mjs`: a minimal REST backend for `/api/users`
- `host/`: a Vite-based browser host that mounts the generated app

## Generate the App Source Tree

From the repo root:

```bash
npm run build:generated --workspace=@loj/example-user-admin
```

This writes a structured React source tree to `subprojects/rdsl/examples/user-admin/generated/` together with `.rdsl/semantic-manifest.json` and `.rdsl/trace-manifest.json`. The generated tree is local build output and is not checked into the repo.

## Run the Mock API

From the repo root:

```bash
npm run mock-api --workspace=@loj/example-user-admin
```

The server listens on `http://localhost:3001` and implements:

- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`

## Install the Browser Host

The browser host lives in `subprojects/rdsl/examples/user-admin/host/` as a standalone example package.

From the repo root:

```bash
npm run ci:install-rdsl-host-deps
```

This keeps the Vite/react-dom baseline isolated from the workspace build while the host remains example-specific.

If you want to resync the checked-in host against the canonical React/Vite template without overwriting local starter files such as `host/package.json` or `host/src/host-config.tsx`:

```bash
npm run host:sync --workspace=@loj/example-user-admin
```

## Run the Browser Host

One-command watch-mode demo orchestration:

```bash
npm run demo:dev --workspace=@loj/example-user-admin
```

This starts three coordinated processes:

- the mock API
- `rdsl dev` writing to `.rdsl-dev/generated/`
- the Vite host pointed at that watch output

To inspect the plan without starting processes:

```bash
npm run demo:dev --workspace=@loj/example-user-admin -- --dry-run
```

Production-like generated output:

```bash
npm run mock-api --workspace=@loj/example-user-admin
npm run host:dev --workspace=@loj/example-user-admin
```

`host:dev` rebuilds `generated/` before starting Vite, so the browser host always starts from the current DSL output.

Watch-mode generated output:

```bash
npm run mock-api --workspace=@loj/example-user-admin
npm run dev:generated --workspace=@loj/example-user-admin
RDSL_GENERATED_DIR=../.rdsl-dev/generated npm --prefix subprojects/rdsl/examples/user-admin/host run dev
```

The host defaults to `http://127.0.0.1:3001` for the API. Override it with either:

- `VITE_RDSL_API_BASE=http://127.0.0.1:3001`
- `window.__RDSL_API_BASE__ = 'http://127.0.0.1:3001'`

## Host Runtime Wiring

The host keeps generated output opaque and only owns mount/provider/api wiring. The generated app still owns routes, layout, pages, and runtime-component usage.

The checked-in example host now composes the reusable helpers from `subprojects/rdsl/packages/host-react/`; only example-specific auth/API/generated-dir defaults stay local to `subprojects/rdsl/examples/user-admin/host/src/host-config.tsx`.
Its Vite config also composes the shared `@loj-lang/rdsl-host-react/vite` helper instead of duplicating generated-dir alias and dev-server wiring, and the overall file set can now be regenerated from the canonical `@loj-lang/rdsl-host-react/template` export via `rdsl host sync-react`.

```tsx
import React from 'react';
import {
  ReactDslHostProviders,
  ReactDslHostStatus,
  ReactDslHostToasts,
  resolveHostApiBase,
} from '@loj-lang/rdsl-host-react';
import type { AuthState, ToastMessage } from '@loj-lang/rdsl-runtime';

const DEFAULT_AUTH: AuthState = {
  currentUser: { id: 'demo-admin', role: 'admin' },
};

function formatMessage(message: ToastMessage): string {
  if (typeof message === 'string') {
    return message;
  }
  return message.defaultMessage ?? message.key;
}

export function HostProviders({ children }: { children?: React.ReactNode }) {
  const apiBase = React.useMemo(() => resolveHostApiBase(__RDSL_API_BASE__), []);
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
```

The checked-in host also adds:

- a Vite alias so the same source can mount `generated/` or `.rdsl-dev/generated/`
- a small toast viewport
- internal link interception so generated `<a href="/users">` navigation stays inside the browser session
- a starter `formatMessage()` hook in `host-config.tsx`, so future message-key/i18n work can stay in the host/rdsl-runtime layer

If a different shell app already serves the API from the same origin, `ResourceProvider` is optional because the runtime defaults to a same-origin fetch client.
