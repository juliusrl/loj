# Full-Stack User Admin Example

This example is the first repo-native `loj.project.yaml` orchestration slice.

If you only want the shortest proof path:

```bash
npm install
npm run demo:loj
npm run demo:loj:fastapi
```

That shows the same full-stack example switching backend target from Spring Boot to FastAPI.

It does not introduce new business DSL syntax. It only wires existing sibling DSL targets:

- `../../subprojects/rdsl/examples/user-admin/app.web.loj`
- `../../subprojects/sdsl/examples/user-service/app.api.loj`
- `../../subprojects/sdsl/examples/user-service/app.fastapi.api.loj`

Its `dev:` block also reuses the existing React host at `../../subprojects/rdsl/examples/user-admin/host` so one `loj dev`
session can now:

- watch and rebuild frontend and backend generated output
- run the React/Vite host
- run the generated Spring Boot or FastAPI server
- proxy frontend `/api/*` requests to the local backend
- inject local Basic auth into that proxy for the generated backend MVP via `.env`

## Files

- `loj.project.yaml` — Spring Boot backend variant
- `loj.fastapi.project.yaml` — FastAPI backend variant
- `.env` — checked-in local demo env for non-secret project-shell values
- `generated/frontend/` — local `rdsl build` output
- `generated/backend/` — local Spring-target `sdsl build` output
- `generated/backend-fastapi/` — local FastAPI-target `sdsl build` output

These generated directories are local build outputs. They are not checked into the repo.

## Commands

```bash
# Validate the Spring-backed project variant
npm run validate --workspace=@loj/example-fullstack-user-admin

# Build the Spring-backed variant into generated/frontend and generated/backend
npm run build:generated --workspace=@loj/example-fullstack-user-admin

# Watch and rebuild the Spring-backed variant
npm run dev --workspace=@loj/example-fullstack-user-admin

# Run the browser-level Spring-backed smoke against `loj dev`
npm run e2e --workspace=@loj/example-fullstack-user-admin

# Validate the FastAPI-backed project variant
npm run validate:fastapi --workspace=@loj/example-fullstack-user-admin

# Build the FastAPI-backed variant into generated/frontend and generated/backend-fastapi
npm run build:generated:fastapi --workspace=@loj/example-fullstack-user-admin

# Watch and rebuild the FastAPI-backed variant
npm run dev:fastapi --workspace=@loj/example-fullstack-user-admin

# Run the browser-level FastAPI-backed smoke against `loj dev`
npm run e2e:fastapi --workspace=@loj/example-fullstack-user-admin
```

Recommended order:

1. `npm run validate --workspace=@loj/example-fullstack-user-admin`
2. `npm run build:generated --workspace=@loj/example-fullstack-user-admin`
3. `npm run dev --workspace=@loj/example-fullstack-user-admin`
4. `npm run e2e --workspace=@loj/example-fullstack-user-admin`

Then repeat the same flow with the FastAPI variants.

Before the first `npm run dev`, make sure the shared React host has its local dependencies installed:

```bash
npm run ci:install-rdsl-host-deps
```

Before the first `npm run e2e`, install the local browser dependency and Chromium for this example:

```bash
npm install --prefix examples/fullstack-user-admin
npx --prefix examples/fullstack-user-admin playwright install chromium
```

This example now proves one-command multi-target validation, generation, watch-based rebuild
orchestration, frontend host startup, backend server startup, local `/api/*` proxying, and
browser-driven CRUD smokes against generated Spring Boot and FastAPI backend variants.

Current env story for this example:

- checked-in shared defaults live in [.env](../../examples/fullstack-user-admin/.env)
- machine-local overrides can live in `.env.local`
- target-scoped overrides can live in `.env.frontend.local` / `.env.backend.local`
- the checked-in `.env` currently only carries `LOJ_DEV_PROXY_AUTH` for the local MVP backend

The Spring-backed variant is one of the current repo-level release examples, so its browser smoke
is part of the formal CI gate. The FastAPI-backed variant is currently an implemented local/demo
variant, not yet a separate required CI lane.

To retain failure artifacts during local debugging, set:

```bash
LOJ_E2E_ARTIFACT_DIR=.artifacts/local-e2e npm run e2e --workspace=@loj/example-fullstack-user-admin
LOJ_E2E_ARTIFACT_DIR=.artifacts/local-e2e npm run e2e:fastapi --workspace=@loj/example-fullstack-user-admin
```

Current Spring-backed dev URLs come from `loj.project.yaml`:

- frontend host: `http://127.0.0.1:5173`
- backend server: `http://127.0.0.1:3001`
- frontend API base: `/api`
- local proxy auth: from `.env` / `.env.local`

Current FastAPI-backed dev URLs come from `loj.fastapi.project.yaml`:

- frontend host: `http://127.0.0.1:5174`
- backend server: `http://127.0.0.1:3002`
- frontend API base: `/api`
- local proxy auth: from `.env` / `.env.local`
