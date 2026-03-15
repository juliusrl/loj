# Loj Env / Project Story

## Status

This document describes the current implemented baseline for the second beta gate.

Current implemented baseline:

- `loj validate`, `loj build`, and `loj dev` all load conventional project env files near `loj.project.yaml`
- shared env files are supported:
  - `.env`
  - `.env.local`
- target-scoped env files are supported:
  - `.env.<target-alias>`
  - `.env.<target-alias>.local`
- `loj dev` watches those env files and reloads target sessions plus managed host/server processes when they change
- project-wide host/server conventions can now be overridden through a narrow `LOJ_DEV_*` env surface

Still intentionally deferred:

- arbitrary env templating inside `loj.project.yaml`
- multiple host/server stacks in one project file
- non-conventional per-target process scripting

---

## Purpose

The env story should make local full-stack development predictable without turning `loj.project.yaml` into a generic deployment config file.

It should answer:

- where local config belongs
- which values are safe to check in
- which values stay local-only
- how shared vs target-scoped env reaches generated targets

It should not turn orchestration into a shell-script DSL.

---

## File Discovery

`loj` loads env files from the same directory as `loj.project.yaml`.

Shared files:

- `.env`
- `.env.local`

Target-scoped files:

- `.env.<target-alias>`
- `.env.<target-alias>.local`

Example:

```text
examples/fullstack-user-admin/
  loj.project.yaml
  .env
  .env.local
  .env.frontend
  .env.frontend.local
  .env.backend
  .env.backend.local
```

---

## Precedence

Current precedence is:

1. `.env`
2. `.env.local`
3. `.env.<target-alias>`
4. `.env.<target-alias>.local`
5. shell environment from the invoking process

Interpretation:

- checked-in shared defaults live in `.env`
- machine-local shared overrides live in `.env.local`
- checked-in target defaults live in `.env.<target-alias>`
- machine-local target overrides live in `.env.<target-alias>.local`
- exported shell env still wins over file-based env

---

## Narrow Project Keys

The project shell currently recognizes a small set of `LOJ_DEV_*` keys:

- `LOJ_DEV_HOST`
- `LOJ_DEV_HOST_PORT`
- `LOJ_DEV_HOST_PREVIEW_PORT`
- `LOJ_DEV_API_BASE`
- `LOJ_DEV_PROXY_AUTH`
- `LOJ_DEV_SERVER_HOST`
- `LOJ_DEV_SERVER_PORT`

These keys override the conventional local UX values that would otherwise come from `dev.host` / `dev.server` or from current defaults.

They are intentionally narrow:

- no arbitrary key interpolation into `loj.project.yaml`
- no command templating
- no generic env bag in the project file

---

## Target-Scoped Injection

Each target receives:

- shared env from `.env` / `.env.local`
- target-scoped env from `.env.<target>` / `.env.<target>.local`

Current behavior:

- `loj validate` and `loj build` pass effective target env into the delegated target CLI
- `loj dev` passes effective target env into the delegated target dev loop
- managed local processes also receive target env:
  - frontend host receives frontend target env
  - backend server receives backend target env

`loj dev` also injects a few compiler-owned local variables into managed processes, for example:

- `RDSL_GENERATED_DIR`
- `VITE_RDSL_API_BASE`
- `RDSL_PROXY_API_TARGET`
- `RDSL_PROXY_API_AUTH`
- `SERVER_ADDRESS`
- `SERVER_PORT`
- `LOJ_PROJECT_FILE`
- `LOJ_PROJECT_DIR`
- `LOJ_TARGET_ALIAS`
- `LOJ_TARGET_TYPE`

Compiler-owned variables win over file-based env for the same keys.

---

## Project File Boundary

Keep these in `loj.project.yaml`:

- target membership
- target entry files
- output directories
- host/server topology
- stable dev-shell structure

Keep these in env files:

- local proxy credentials
- local host/server port overrides
- target-local framework env
- machine-specific integration settings

Do not put these in `loj.project.yaml`:

- passwords or tokens where avoidable
- arbitrary per-target env bags
- shell commands
- deployment-specific infrastructure state

---

## Checked-In Vs Local

Recommended rule:

- `.env` may be checked in when values are non-secret and help examples run out of the box
- `.env.local` and `.env.<target>.local` should remain local-only

Current release-example pattern:

- `examples/fullstack-user-admin/.env` is checked in because the demo Basic auth credential is only a local MVP convenience, not a real secret
- real secret material should still live in local-only env files

---

## Release Example

The current release example uses:

- [loj.project.yaml](../examples/fullstack-user-admin/loj.project.yaml)
- [.env](../examples/fullstack-user-admin/.env)

That means:

- topology stays in the project file
- local proxy auth stays in env
- default host/backend ports remain convention-driven unless overridden

EOF