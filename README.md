# Loj

[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md)

**AI-native sibling DSL family for business-system code generation.**

`0.5.0 (Logos)`

> [!NOTE]
> **Official Website Coming Soon:** I am building [loj.org](https://loj.org) to serve as the canonical home for interactive documentation, playground, and community showcases.

<details>
<summary><strong>Minimal source vs generated UI</strong></summary>

<table>
  <tr>
    <td valign="top" width="52%">

```loj
// examples/fullstack-minimal-users/frontend/app.web.loj
app:
  name: "Minimal Users"
  navigation:
    - group: "Admin"
      items:
        - label: "Users"
          target: resource.users.list

model User:
  name: string @required
  email: string @required @email

resource users:
  model: User
  api: /api/users
  list:
    title: "Users"

// examples/fullstack-minimal-users/backend/app.api.loj
app:
  name: "Minimal Users API"
  package: "com.example.minimalusers"

model User:
  name: string @required
  email: string @required @email

resource users:
  model: User
  api: /api/users
```

This exact minimal example lives under [examples/fullstack-minimal-users](examples/fullstack-minimal-users/README.md). From a small source surface like this, Loj expands into a generated React admin shell plus a generated Spring Boot or FastAPI backend.

  </td>
  <td valign="top" width="48%">
    <img src="docs/public-proof-assets/readme-user-admin-preview.svg" alt="Generated admin-style UI preview" />
  </td>
  </tr>
</table>

</details>

## Quick Start

```bash
npm install -g @loj-lang/cli
loj --help
```

Without a global install:

```bash
npx @loj-lang/cli --help
```

Loj is an AI-native DSL family for building business systems with a small set of target-neutral primitives. The goal is not generic vibe-coded pages. The goal is to keep business intent narrow and stable, then compile it into framework-specific frontend and backend code with traceable escape hatches.

Today the public repo proves three things:

- one web-family DSL can generate a real React/TypeScript frontend
- one api-family DSL can generate two backend targets from the same source
- one project shell can validate, build, and run them together as a full-stack app

Current implemented target surface:

- `.web.loj` frontend-family source -> `react/typescript`
- `.api.loj` backend-family source -> `spring-boot/java/mvc-jpa-security`
- `.api.loj` backend-family source -> `fastapi/python/rest-sqlalchemy-auth`
- `loj.project.yaml` -> multi-target validate/build/dev orchestration

Legacy aliases kept for the current beta cycle:

- `.rdsl` -> frontend-family legacy alias for `.web.loj`
- `.sdsl` -> backend-family legacy alias for `.api.loj`

## Why This Exists

LLMs are much better at narrow, declarative, schema-checked languages than at sprawling imperative framework code. Loj leans into that:

- keep primitives narrow and target-neutral where possible
- push framework differences down into `target + language + profile`
- treat runtimes, templates, and escape hatches as target-specific layers
- keep source code dense, generated code expanded, and tooling traceable

That is why the same `.api.loj` business semantics can already compile to both Spring Boot and FastAPI.

## What Works Today

- web family:
  - resources, pages, read-models, workflows, linked rules, grouped/pivot table consumers
  - shell-level styles via `.style.loj`
  - app/page SEO metadata and asset refs
- api family:
  - models, resources, nested writes, read-models, workflows, linked rules
  - Spring Boot and FastAPI generation
  - read-only `@sql("./queries/x.sql")` for narrow read-model escape
- project shell:
  - `loj validate`
  - `loj build`
  - `loj dev`
  - `loj rebuild`
  - `loj restart`
  - `loj status`
  - `loj doctor`
  - `loj stop`
  - single-target project-shell flows via `--target <alias>`
  - database/runtime/dev orchestration via `loj.project.yaml`

The repo is currently best described as a **community-demo-ready full-stack alpha** for business systems.

## Public Evaluation Path

If you only want one evaluation path, start with the flight-booking proof:

```bash
npm install
npm run demo:loj:booking-proof:proof
```

That path exercises:

- a shared-query search flow
- grouped result consumption
- workflow/wizard handoff
- nested aggregate writes
- linked rules
- Spring Boot and FastAPI generation under the same business model

If you prefer a stronger back-office vertical, run:

```bash
npm run demo:loj:invoice:proof
```

If you want the minimal full-stack baseline instead, run:

```bash
npm run demo:loj
```

If you want the booking proof or user-admin baseline switched to FastAPI:

```bash
npm run demo:loj:booking-proof:fastapi
npm run demo:loj:fastapi
```

## Quick Start

```bash
npm install

# strongest current business-system proof
npm run demo:loj:booking-proof:proof

# stronger back-office showcase
npm run demo:loj:invoice:proof

# original baseline
npm run demo:loj
```

Go ahead, **Loj it! 🚀**

If you want to work from `loj.project.yaml` directly instead of repo demo scripts:

```bash
loj validate examples/fullstack-flight-booking-proof/loj.project.yaml
loj build examples/fullstack-flight-booking-proof/loj.project.yaml
loj dev examples/fullstack-flight-booking-proof/loj.project.yaml
loj rebuild examples/fullstack-flight-booking-proof/loj.project.yaml --target frontend
loj restart examples/fullstack-flight-booking-proof/loj.project.yaml --service host

# single-target project-shell flow
loj build examples/fullstack-flight-booking-proof/loj.project.yaml --target backend
```

## Minimal Mental Model

Frontend-family authoring:

```yaml
resource users:
  model: User
  api: /api/users
  list:
    columns: [name, role, status]
  edit:
    fields: [name, role, status]
```

Backend-family authoring:

```yaml
resource users:
  model: User
  api: /api/users
  operations: [list, get, create, update, delete]
```

The point is not the exact generated syntax. The point is that the source stays narrow while targets stay free to emit framework-optimal code.

## CLI Reference
    
### Project Commands
    
These commands typically operate on `loj.project.yaml` to orchestrate multi-target builds and runtimes.
    
- **`loj validate <project>`**: Validates the entire project DSL, target configurations, and environment variables. Supports `--json`.
- **`loj build <project>`**: Builds all targets defined in the project. Supports `--json`.
- **`loj dev <project>`**: Starts an enhanced development mode with file watching, incremental builds, and managed service orchestration.
  - `--target <alias>`: Start dev flow for a specific target only (e.g., `backend`).
  - `--debug`: Enable verbose debug logging.
  - Supports `--json`.
- **`loj rebuild <project>`**: Queues a manual rebuild inside the active `loj dev` session.
  - `--target <alias>`: Rebuild only the selected target (for example `frontend` when iterating on styles).
  - Supports `--json`.
- **`loj restart <project>`**: Restarts managed services inside the active `loj dev` session.
  - `--service <host|server|all>`: Restart only the frontend host, only the backend server, or both.
  - Supports `--json`.
- **`loj status <project>`**: Inspects active service status, URLs, health probes, and debugger endpoints. Supports `--json`.
- **`loj stop <project>`**: Stops the currently active managed dev session. Supports `--json`.
- **`loj doctor <project>`**: Deep diagnostics for the dev environment, checking dependency integrity and artifact linkage. Supports `--json`.
    
### Individual Commands
    
For processing standalone DSL artifacts:
    
- **`loj rules validate/build <file.rules.loj>`**: Validates or builds standalone rules. Supports `--json` and `--out-dir`.
- **`loj flow validate/build <file.flow.loj>`**: Validates or builds standalone workflows. Supports `--json` and `--out-dir`.
    
### Agent/Skill Management
    
For managing AI agent domain skills:
    
- **`loj agent install <provider>`**: Installs bundled skills to a specific IDE. 
  - `<provider>`: `codex`, `windsurf`, or `generic`.
  - `--scope <user|project>`: Install to global user space or project-local directory.
- **`loj agent add <provider> --from <source>`**: Pulls and installs skills from a local path or remote source.
- **`loj agent export <provider> --out-dir <dir>`**: Exports bundled skill assets for manual integration.

## Command Stance

For normal use, prefer the `loj` project-shell commands listed above.

`rdsl` and `sdsl` still exist as family-local tools, but they are now secondary paths for compiler-focused or single-family work. They are no longer the default public entrypoint.

## Repo Shape

```text
subprojects/
  rdsl/   web-family toolchain, docs, and example
  sdsl/   api-family toolchain, docs, and example
packages/
  loj-cli/            project-level orchestration CLI
  loj-vscode/         repo-level VSCode extension
  loj-benchmark-core/ benchmark harness
examples/
  fullstack-user-admin/            full-stack baseline
  fullstack-invoice-backoffice/    stronger back-office showcase
  fullstack-flight-booking-proof/  strongest business-system proof path today
docs/
  repo-level notes and contracts
```

## Read Next

For the public authoring surface, start with:

- [skills/loj-authoring/SKILL.md](./skills/loj-authoring/SKILL.md) — Public AI-authoring skill for Loj
- [loj-project-file-contract.md](./docs/loj-project-file-contract.md) — Canonical `loj.project.yaml` contract
- [recommended-project-structure.md](./docs/recommended-project-structure.md) — Recommended directory layout
- [env-project-story.md](./docs/env-project-story.md) — Environment variables and project loading
- [rdsl-reference.md](./subprojects/rdsl/docs/rdsl-reference.md) — Canonical core frontend-family syntax reference (.web.loj)
- [sdsl-reference.md](./subprojects/sdsl/docs/sdsl-reference.md) — Canonical core backend-family syntax reference (.api.loj)

The skill is the public AI-facing entrypoint. The two reference docs remain the syntax truth.

## Install The Skill

If you want to install the public `loj-authoring` skill for Codex-compatible workflows:

```bash
# install to user scope
npx @loj-lang/cli agent install codex

# install to Windsurf's default skills directory
npx @loj-lang/cli agent install windsurf

# install a vendored project copy
npx @loj-lang/cli agent install codex --scope project

# export the bundled skill to any directory
npx @loj-lang/cli agent export codex --out-dir ./tooling/skills

# install from a local or remote skill bundle source
npx @loj-lang/cli agent add codex --from ./tooling/skills/loj-authoring

# install directly from the GitHub release asset
npx @loj-lang/cli agent add codex --from https://github.com/juliusrl/loj/releases/download/v0.5.0/loj-authoring-0.5.0.tgz

# install into any explicit skills directory
npx @loj-lang/cli agent install generic --skills-dir ~/.my-agent/skills
```

The current direct pull path is through the published CLI package:
- bundled install: `loj agent install ...`
- remote/local bundle install: `loj agent add ...`

## VSCode Extension

The current VSCode beta is distributed as a VSIX release asset:

- `loj-vscode-0.5.0.vsix`

Install it from the GitHub release page or in VSCode via:

- `Extensions: Install from VSIX...`

## License

Apache 2.0
