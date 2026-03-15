# Loj Project File Contract (loj.project.yaml)

This document defines the schema and behavior of the `loj.project.yaml` file, which serves as the orchestration layer for Loj full-stack applications.

## Purpose

`loj.project.yaml` is responsible for:
- Defining the targets (frontend, backend, etc.) that make up the application.
- Specifying entry points for each target's DSL source code.
- Configuring output directories for generated code.
- Orchestrating the development environment (dev hosts and servers).
- Providing database and runtime profiles for generated targets.

It **must not** contain business semantics (models, resources, etc.); those belong in `.web.loj` or `.api.loj` files.

---

## Minimal Example

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

---

## Field Reference

### Top-Level Sections

| Field | Status | Description |
| --- | --- | --- |
| `app` | **Required** | General application metadata. |
| `targets` | **Required** | Map of logical target aliases to their configurations. |
| `dev` | Optional | Development-time orchestration settings. |

### `app` Section

| Field | Status | Description |
| --- | --- | --- |
| `name` | **Required** | The logical name of the application (e.g., `invoice-system`). |

### `targets` Section

Each entry in `targets` is a map where the key is a **logical alias** (e.g., `frontend`, `backend`, `admin-api`).

| Field | Status | Description |
| --- | --- | --- |
| `type` | **Required** | `web` (frontend) or `api` (backend). |
| `entry` | **Required** | Relative path to the `.web.loj` or `.api.loj` entry file. |
| `outDir` | Optional | Directory where generated code will be placed. Defaults to target-specific conventions. |
| `database` | Optional | Database configuration (primarily for `api` targets). |
| `runtime` | Optional | Runtime environment settings (base paths, CORS, etc.). |

#### `database` Slice

Supported on `api` targets.

| Field | Status | Description |
| --- | --- | --- |
| `vendor` | **Required** | `h2`, `sqlite`, `postgres`, `mysql`, `mariadb`, `sqlserver`, `oracle`. |
| `mode` | Optional | `embedded`, `external`, or `docker-compose`. |
| `name` | Optional | Database name. Defaults to a name derived from `app.name`. |
| `host` | Optional | Database host. Defaults to `127.0.0.1` for external vendors. |
| `port` | Optional | Database port. |
| `username` | Optional | Database username. |
| `password` | Optional | Database password. |
| `autoProvision`| Optional | If `true`, the project shell may automatically start/provision the database (e.g., via Docker). |
| `migrations` | Optional | `none`, `native-sql`, or `flyway`. |

#### `runtime` Slice

| Field | Status | Description |
| --- | --- | --- |
| `basePath` | Optional | The URL base path for the service (supported on `api` and `web`). |
| `shutdown` | Optional | Shutdown behavior (`api` only). Includes `mode` (`graceful`\|`immediate`) and `timeout`. |
| `health` | Optional | Health check endpoint path (e.g., `/health`). |
| `readiness` | Optional | Readiness probe endpoint path (e.g., `/ready`). |
| `cors` | Optional | CORS configuration (`api` only). Requires `origins`. |
| `forwardedHeaders` | Optional | Forwarded headers mode (`standard`\|`none`). |
| `trustedProxy` | Optional | Trusted proxy configuration. |
| `requestSizeLimit` | Optional | Maximum request body size (e.g., `10mb`). |

---

### `dev` Section (Orchestration)

Configures the managed development loop started by `loj dev`.

#### `dev.host` (Frontend)

| Field | Status | Description |
| --- | --- | --- |
| `target` | **Required** | Alias of a `web` target. |
| `dir` | **Required** | Path to the directory containing the host project (e.g., Vite/React project). |
| `type` | Optional | `react-vite` (default). |
| `port` | Optional | Dev server port (default `5173`). |
| `apiBase` | Optional | Proxy prefix (default `/api`). |
| `proxyTarget`| Optional | Alias of the `api` target to proxy to. |

#### `dev.server` (Backend)

| Field | Status | Description |
| --- | --- | --- |
| `target` | **Required** | Alias of an `api` target. |
| `port` | Optional | Backend server port (default `3001`). |

---

## Environment Variables

The project shell automatically loads environment variables from the following files (relative to the project file):
1.  `.env`
2.  `.env.local`
3.  `.env.<target-alias>`
4.  `.env.<target-alias>.local`

Variables in `.env.local` override `.env`. Target-specific files override general files.

---

## Guardrails

- **Keep it Orchestration-only**: Do not add logic or business rules here.
- **Convention over Configuration**: Use overrides only when defaults don't fit your target framework's best practices.
- **Relative Paths**: All paths in `loj.project.yaml` are relative to the file's directory.
