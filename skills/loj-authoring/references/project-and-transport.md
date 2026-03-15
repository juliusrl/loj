# Project File And Transport

Use this reference for `loj.project.yaml`, full-stack orchestration, target-level database/runtime
profiles, and the shared frontend↔backend HTTP/JSON baseline.

## `loj.project.yaml` Purpose

`loj.project.yaml` is orchestration only.

It answers:

- what targets belong to the app
- where each target entry file lives
- where generated output should go
- which dev host/server topology should run together
- which project-shell database/runtime profile should be prepared for generated targets

It must not contain business semantics such as:

- `model`
- `resource`
- `page`
- controllers/entities/services
- frontend layout details

## Recommended Directory Structure

For new projects, default to this shape unless the task explicitly needs something else:

```text
my-app/
  loj.project.yaml

  frontend/
    app.web.loj
    models/
    resources/
    read-models/
    pages/
    rules/
    workflows/
    styles/
    components/
    logic/
    assets/

  backend/
    app.api.loj
    models/
    resources/
    read-models/
    rules/
    workflows/
    handlers/
    policies/
    queries/
```

Use this as a recommendation, not a parser requirement.

Intent:

- `frontend/` keeps `.web.loj`, `.style.loj`, frontend rules/workflows, host components, and assets together
- `backend/` keeps `.api.loj`, backend rules/workflows, `@fn(...)` handlers/policies, and `@sql(...)` queries together
- `loj.project.yaml` stays at the app root

## Minimal Shape

```yaml
app:
  name: user-admin

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
  backend:
    type: api
    entry: backend/app.api.loj
```

Rules:

- `app.name` is required
- `targets` is required
- each target has:
  - logical alias key
  - `type`
  - `entry`
- `entry` is relative to the project file

## Target Types

Preferred:

- `web`
- `api`

Legacy aliases still accepted during the beta window:

- `rdsl`
- `sdsl`

Use `web/api` for new project files.

## Current Expanded Shape

```yaml
app:
  name: flight-booking-proof

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
    runtime:
      basePath: /console
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend
    database:
      vendor: postgres
      mode: docker-compose
      name: booking_app
      username: loj
      password: loj
      autoProvision: true
      migrations: native-sql
    runtime:
      basePath: /internal-api
      shutdown:
        mode: graceful
        timeout: 30s
      health:
        path: /health
      readiness:
        path: /ready
      drain:
        path: /drain
      cors:
        origins: ["http://127.0.0.1:5173"]
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: local
      requestSizeLimit: 10mb

dev:
  host:
    type: react-vite
    target: frontend
    dir: ./generated/frontend
    apiBase: /api
    proxyTarget: backend
  server:
    target: backend
```

Rules:

- the project file stays declarative
- do not put shell commands in it
- do not turn it into a generic env bag
- database/runtime slices live here, not in `.web.loj` / `.api.loj`

Complete Spring-style example:

```yaml
app:
  name: flight-booking-proof

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
    outDir: generated/frontend
    runtime:
      basePath: /console
  backend:
    type: api
    entry: backend/app.api.loj
    outDir: generated/backend-postgres
    database:
      vendor: postgres
      mode: docker-compose
      name: flight_booking_proof
      username: loj
      password: loj
      autoProvision: true
      migrations: flyway
    runtime:
      basePath: /internal-api
      shutdown:
        mode: graceful
        timeout: 30s
      cors:
        origins: [http://127.0.0.1:5173]
        methods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
        headers: [Authorization, Content-Type]
        credentials: true
      forwardedHeaders:
        mode: standard
      trustedProxy:
        mode: local
      health:
        path: /healthz
      readiness:
        path: /readyz
      drain:
        path: /drainz
      requestSizeLimit: 10mb

dev:
  host:
    type: react-vite
    target: frontend
    dir: ../../subprojects/rdsl/examples/user-admin/host
    apiBase: /api
    proxyTarget: backend
  server:
    target: backend
```

## Current CLI Mapping

Project-shell commands are the preferred default when `loj.project.yaml` exists:

- `loj validate loj.project.yaml`
- `loj build loj.project.yaml`
- `loj dev loj.project.yaml`
- `loj dev loj.project.yaml --debug`
- `loj rebuild loj.project.yaml --target frontend`
- `loj restart loj.project.yaml --service host`
- `loj status loj.project.yaml`
- `loj stop loj.project.yaml`
- `loj doctor loj.project.yaml`

Single-target project-shell flows keep database/runtime profiles active:

- `loj validate loj.project.yaml --target backend`
- `loj build loj.project.yaml --target backend`
- `loj dev loj.project.yaml --target backend`
- `loj status loj.project.yaml --target backend`
- `loj doctor loj.project.yaml --target backend`

Target-local CLIs remain available as secondary tools:

- `rdsl validate/build`
- `sdsl validate/build/dev`

Use `loj.project.yaml` whenever you need project-shell database/runtime/dev orchestration, even if
you are only generating one target.

Command stance:

- default: `loj ...`
- secondary/high-signal local tooling: `rdsl ...` / `sdsl ...`
- do not recommend `rdsl build` / `sdsl build` as the default path for new user-facing full-stack
  examples

## Required, Optional, Defaults

Core field status:

| Path | Status | Current default / note |
| --- | --- | --- |
| `app.name` | required | non-empty string |
| `targets` | required | must contain at least one target |
| `targets.<alias>.type` | required | `web | api` preferred; `rdsl | sdsl` still accepted as legacy aliases |
| `targets.<alias>.entry` | required | non-empty relative path |
| `targets.<alias>.outDir` | optional | build falls back to target-local defaults when omitted |
| `targets.<alias>.database` | optional | `api` targets only |
| `targets.<alias>.runtime` | optional | `api` targets may use the narrow runtime slice; `web` currently only uses `runtime.basePath` |
| `dev` | optional | no managed dev processes when omitted |
| `dev.server` | optional | starts no backend process when omitted |
| `dev.server.target` | required when `dev.server` exists | must reference an `api` target |
| `dev.server.host` | optional | `127.0.0.1` |
| `dev.server.port` | optional | `3001` |
| `dev.host` | optional | starts no frontend host when omitted |
| `dev.host.type` | optional | `react-vite` |
| `dev.host.target` | required when `dev.host` exists | must reference a `web` target |
| `dev.host.dir` | required when `dev.host` exists | non-empty relative path |
| `dev.host.host` | optional | `127.0.0.1` |
| `dev.host.port` | optional | `5173` |
| `dev.host.previewPort` | optional | `4173` |
| `dev.host.apiBase` | optional | `/api` |
| `dev.host.proxyTarget` | optional | defaults to `dev.server.target` when a local backend is also configured |
| `dev.host.proxyAuth` | optional | no default |

Database defaults:

| Path | Status | Current default / note |
| --- | --- | --- |
| `database.vendor` | required when `database` exists | `h2 | sqlite | postgres | mysql | mariadb | sqlserver | oracle` |
| `database.mode` | optional | `embedded` for `h2/sqlite`, otherwise `external` |
| `database.name` | optional | derived from `app.name`; `sqlite` becomes `<app>.db`, `oracle` becomes `FREEPDB1` |
| `database.host` | optional | external vendors default to `127.0.0.1` |
| `database.port` | optional | vendor default where applicable |
| `database.username` | optional | vendor default |
| `database.password` | optional | vendor default |
| `database.autoProvision` | optional | `false` |
| `database.migrations` | optional | `none` |

Runtime defaults:

| Path | Status | Current default / note |
| --- | --- | --- |
| `runtime.basePath` | optional | no default; supported on `api` and `web` targets |
| `runtime.shutdown` | optional | `api` targets only |
| `runtime.shutdown.mode` | optional inside `shutdown` | `graceful` |
| `runtime.shutdown.timeout` | optional inside `shutdown` | `30s` |
| `runtime.health.path` | optional | no default helper emitted unless declared |
| `runtime.readiness.path` | optional | no default helper emitted unless declared |
| `runtime.drain.path` | optional | no default helper emitted unless declared |
| `runtime.cors` | optional | `api` targets only |
| `runtime.cors.origins` | required when `cors` exists | non-empty string array |
| `runtime.cors.methods` | optional | target defaults when omitted |
| `runtime.cors.headers` | optional | target defaults when omitted |
| `runtime.cors.credentials` | optional | `false` |
| `runtime.forwardedHeaders` | optional | `api` targets only |
| `runtime.forwardedHeaders.mode` | optional inside `forwardedHeaders` | `standard` |
| `runtime.trustedProxy` | optional | `api` targets only |
| `runtime.trustedProxy.mode` | optional inside `trustedProxy` | `local` |
| `runtime.trustedProxy.cidrs` | optional | required only when `mode: cidrs` |
| `runtime.requestSizeLimit` | optional | no default |

Current auto-fill behavior:

- if `runtime.trustedProxy` is declared without `runtime.forwardedHeaders`, the project shell
  currently auto-enables `forwardedHeaders.mode: standard`

## Env Story

Current conventional env files:

- `.env`
- `.env.local`
- `.env.<target-alias>`
- `.env.<target-alias>.local`

`loj validate`, `loj build`, and `loj dev` load these conventionally.

`loj dev` also watches them and reloads managed target sessions when they change.

## Database Slice

`targets.<alias>.database` is currently supported on `api` targets.

Supported fields:

- `vendor`: `h2 | sqlite | postgres | mysql | mariadb | sqlserver | oracle`
- `mode`: `embedded | external | docker-compose`
- `name`
- `host`
- `port`
- `username`
- `password`
- `autoProvision`
- `migrations`: `none | native-sql | flyway`

Current intent:

- database choice stays in project/runtime orchestration
- generated targets may emit runtime-specific config plus native `db/schema.sql`
- `loj dev` may auto-start/stop generated `docker-compose.database.yaml` when
  `mode: docker-compose` and `autoProvision: true`

## Runtime Slice

`targets.<alias>.runtime` currently supports:

- on `api` targets:
  - `basePath`
  - `shutdown.mode`
  - `shutdown.timeout`
  - `health.path`
  - `readiness.path`
  - `drain.path`
  - `cors.origins`
  - `cors.methods`
  - `cors.headers`
  - `cors.credentials`
  - `forwardedHeaders.mode`
  - `trustedProxy.mode`
  - `trustedProxy.cidrs`
  - `requestSizeLimit`
- on `web` targets:
  - `basePath`

Keep this narrow. It expresses generated runtime/deploy intent, not business semantics.

## Dev Story

Current `loj dev` scope:

- starts target-local rebuild loops
- can run a React/Vite host for the configured web target
- can run the configured backend server
- can auto-provision supported Docker Compose databases
- persists dev-session state for `status`, `stop`, and editor reuse
- accepts `loj rebuild` to queue a manual rebuild for all or selected active targets
- accepts `loj restart` to restart managed `host` and/or `server` processes without restarting the whole loop
- may expose attachable debugger endpoints through `loj dev --debug`

Keep this conventional. Do not invent arbitrary process orchestration syntax.

## Neutral Transport Contract

Frontend and backend targets align to a shared HTTP/JSON contract, not directly to each other's
frameworks.

### Lists

Accepted list responses:

- raw JSON array
- `{ items: [...] }`
- `{ data: [...] }`

### Single records

Accepted single-record responses:

- raw JSON object
- `{ item: {...} }`
- `{ data: {...} }`

### Errors

Errors should be non-2xx JSON objects with string `message`.

Current message rule:

- backend targets should return a stable human-readable `message`
- do not invent target-private message templating in source DSL

### IDs

- every resource record includes `id`
- frontend may coerce it to string

### Pagination

- server pagination metadata is still optional
- generated list pagination remains client-side unless the shared transport contract widens later

## Full-Stack Authoring Guardrails

- Keep frontend-family and backend-family semantics in their own files.
- Use `loj.project.yaml` only to compose them.
- If frontend and backend need a richer shared transport shape, evolve the transport contract first.
- Do not hide target mismatches inside project orchestration.
