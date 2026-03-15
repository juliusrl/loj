---
name: loj-authoring
description: >
  Use this skill when creating, editing, reviewing, or debugging `.web.loj` / legacy `.rdsl`
  files, `.api.loj` / legacy `.sdsl` files, `.style.loj` files, linked `.rules.loj` / `.flow.loj`
  slices, or `loj.project.yaml` orchestration files for the Loj DSL framework. Covers current
  web/api/style family syntax, linked rules/workflow/SQL escape hatches, project-shell
  database/runtime/dev commands, and how those inputs map to generated React, Spring Boot, and
  FastAPI output.
---

# Loj Authoring

Use this skill for:

- frontend-family `.web.loj` / legacy `.rdsl`
- style `.style.loj`
- backend-family `.api.loj` / legacy `.sdsl`
- linked `.rules.loj`
- linked `.flow.loj`
- `loj.project.yaml`

(For codex) If this skill is missing outside the repo, current install/export commands are:

- `npx @loj-lang/cli agent install codex`
- `npx @loj-lang/cli agent install codex --scope project`
- `npx @loj-lang/cli agent export codex --out-dir ./tooling/skills`

All portable technique references required by this skill live in `references/`.
You may not have knowledge of the Loj DSL framework at this time, so you must read the references to understand the syntax and semantics of the DSL.
This skill should remain usable even when vendored outside the repo.

| Task involves | Read |
|---|---|
| frontend-family syntax, models/resources/pages/read-model pages, style/SEO/assets, workflow-linked surfaces | `references/frontend-family.md` |
| generated React runtime assumptions, runtime imports, inspect/trace behavior | `references/frontend-runtime-trace.md` |
| backend-family syntax, models/resources/read-models, linked rules/workflow/SQL, transaction defaults | `references/backend-family.md` |
| Spring Boot / FastAPI target-specific output and escape-hatch constraints | `references/backend-targets.md` |
| standalone policy/rules proof syntax and current linkage boundaries | `references/policy-rules-proof.md` |
| standalone workflow/state-machine syntax and current linked resource behavior | `references/workflow-flow-proof.md` |
| `loj.project.yaml`, project-shell database/runtime slices, dev/status/doctor flows, frontend↔backend transport alignment | `references/project-and-transport.md` |

## Workflow

1. Identify whether the task is frontend-family, backend-family, linked rules/workflow, or project-shell orchestration.
2. For new source, prefer canonical suffixes and target names:
   - `.web.loj`, `.api.loj`
   - `type: web`, `type: api`
3. Read only the minimal bundled reference slice from the router above.
4. Generate only implemented syntax from those references.
5. If the requested shape is outside the current slice, say so and use the narrowest implemented escape hatch or project/runtime profile.

## Command Shortcuts

Default recommendation: use project-shell commands first whenever a `loj.project.yaml` exists.

- preferred default:
  - `loj validate loj.project.yaml`
  - `loj build loj.project.yaml`
  - `loj dev loj.project.yaml`
  - `loj rebuild loj.project.yaml --target <alias>`
  - `loj restart loj.project.yaml --service <host|server|all>`
  - `loj status loj.project.yaml`
  - `loj stop loj.project.yaml`
  - `loj doctor loj.project.yaml`
- single-target project-shell:
  - `loj validate loj.project.yaml --target <alias>`
  - `loj build loj.project.yaml --target <alias>`
  - `loj dev loj.project.yaml --target <alias>`
  - `loj status loj.project.yaml --target <alias>`
  - `loj doctor loj.project.yaml --target <alias>`
- standalone rules proof:
  - `loj rules validate <entry.rules.loj>`
  - `loj rules build <entry.rules.loj> --out-dir <dir>`
- standalone workflow proof:
  - `loj flow validate <entry.flow.loj>`
  - `loj flow build <entry.flow.loj> --out-dir <dir>`
- family-local fallback:
  - `rdsl validate <entry.web.loj>`
  - `rdsl build <entry.web.loj> --out-dir <dir>`
  - `sdsl validate <entry.api.loj>`
  - `sdsl build <entry.api.loj> --out-dir <dir>`

Use `rdsl` / `sdsl` mainly for pure single-family work or compiler/debug tasks. Do not treat them as
the default entrypoint for new multi-file app work when `loj.project.yaml` exists.

Useful debugging commands:

- `rdsl inspect <entry.web.loj|build-dir> [--node <id>]`
- `rdsl trace <entry.web.loj|build-dir> <generated-file:line[:col]>`

## Hard Rules

### Common

- Files are a strict YAML subset: no anchors, aliases, merge keys, or custom tags.
- For new files, use canonical suffixes; keep `.rdsl` / `.sdsl` only for legacy edits.
- Prefer single-file apps for small demos. Use `imports:` only when the app really benefits from splitting by domain.
- `imports:` entries are relative family-source paths (`.web.loj` / `.rdsl`, `.api.loj` / `.sdsl`) or directories ending with `/`.
- Nested imports are allowed. Cycles are invalid. Directory imports expand direct children only.
- One root file owns `app:` and `compiler:`. Module files may not contain them.
- Model/resource names must stay unique across the merged namespace.
- Keep primitives target-neutral and business-oriented.
- Do not leak framework/runtime specifics into the DSL source.

### Frontend-family

- Expression language stays constrained. No loops, statements, closures, or inline JS outside implemented escape hatches.
- Escape preference: built-in DSL > `@expr` > `@fn` > `@custom`.
- Treat suffix-bearing escape paths such as `.ts` / `.tsx` as deliberate frontend lock-in, not the default style.
- `toast` accepts static string or descriptor only.
- Current UI-copy descriptor support is still narrow:
  - use plain strings for fixed copy
  - use `{ key?, defaultMessage?, values? }` when future i18n or scalar-literal interpolation matters
  - copy descriptors are currently implemented only on the documented title/label/date-navigation/SEO slices
- `app.style` links `.style.loj`; shell-level `style:` references are currently narrow and do not imply table internals or responsive/mobile variants.
- `app.seo`, `page.seo`, and `@asset(...)` are web metadata/asset surfaces, not style DSL features.
- Escape file paths resolve relative to the declaring `.web.loj` file, not the root file.

### Backend-family

- `compiler:` must use an implemented `target + language + profile` triple.
- `auth:` describes policy intent, not framework internals.
- `operations:` controls generated CRUD endpoints; all default `true` if omitted.
- No frontend concepts like pages, navigation, columns, or toast in `.api.loj`.
- Do not encode Java/Python/SQLAlchemy/JPA into DSL primitives; keep them in target/profile or escape-hatch code.
- `resource auth.policy` may use either `@fn("./policies/x")` or `@rules("./policies/x")`.
- `resource create.rules` may use `@rules("./rules/x")` for narrow create eligibility/validation.
- `readModel rules` may use `@rules("./rules/x")` for narrow eligibility/validation/derivation.
- `resource workflow` may use `@flow("./workflows/x")`.
- `readModel handler` may use `@fn("./handlers/x")` or narrow file-backed `@sql("./queries/x")`.
- `@sql(...)` is read-model-only, read-only, and file-backed; keep procedures and write-oriented SQL in `@fn(...)`.
- Generated write paths are transactional by default in the implemented targets; do not invent `transactional: true`.

### `.rules.loj`

- Use exactly one top-level `rules <name>:` block per file.
- Stay within the current slice:
  - `allow/deny <operation>`
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
  - shared `when`, optional `or`, optional `message`, and list-only `scopeWhen/scope` on auth entries
- `.rules.loj` is linked only through the documented frontend/backend slices; do not invent new integration points.
- Do not put `.rules.loj` under `loj.project.yaml`.

### `.flow.loj`

- Use exactly one top-level `workflow <name>:` block per file.
- Stay within the current slice:
  - `model`
  - `field`
  - `states`
  - optional `wizard.steps`
  - `transitions`
- `.flow.loj` is linked only through `resource workflow: ...` in `.web.loj` / `.api.loj`.
- Do not invent project-shell workflow targets, page-level router DSL, or framework-specific state-machine syntax.

### `loj.project.yaml`

- `loj.project.yaml` is orchestration only. Never place `model`, `resource`, `page`, or backend implementation details in it.
- Prefer `type: web` / `type: api`. Treat `type: rdsl` / `type: sdsl` as deprecated legacy aliases.
- `entry` should point at canonical suffixes for new examples: `app.web.loj`, `app.api.loj`.
- Database/runtime/dev orchestration belongs here, not in `.web.loj` / `.api.loj`.
- Keep `dev:` and `targets.<alias>.runtime` narrow and declarative. Do not turn them into arbitrary scripting or general ops config.
- For new projects, default to the recommended bundled directory structure from `references/project-and-transport.md` instead of inventing an ad hoc tree.

## Review Before Final Output

- Valid strict-YAML-subset?
- Canonical suffix/type chosen for new files unless editing legacy input?
- Read from bundled `references/` rather than guessing from stale memory?
- Top-level keys allowed for this file type (root vs module)?
- Model/resource names unique project-wide?
- Rules/effects within the implemented slice?
- Escape hatches narrow and intentional?
- No framework/runtime detail leaking into family DSL source?
- For `.api.loj`: implemented `target/language/profile` triple and current linkage boundaries respected?
- For `loj.project.yaml`: orchestration-only, with `web/api` preferred and database/runtime/dev slices kept narrow?
