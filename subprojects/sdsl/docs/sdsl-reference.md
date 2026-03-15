# The Lojban Paradigm (Backend-Family `.api.loj`) — LLM Reference Documentation

> **Purpose**: This document is the single source of truth for generating valid backend-family `.api.loj` files for the current backend-family MVP slices.
> Give this to an LLM when you want a narrow, target-neutral backend DSL that currently compiles to Spring Boot + Java or FastAPI + Python.
>
> If you are using repo-local AI skills, use [skills/loj-authoring/SKILL.md](../../../skills/loj-authoring/SKILL.md) as the unified workflow wrapper.
> This file remains the canonical syntax and contract reference.
>
> Legacy note: `.sdsl` remains a supported backend-family alias for the current beta cycle.
>
> Shared shape note: when backend-family source or generated artifacts reuse a stable compiler-neutral descriptor shape that also exists elsewhere in the repo, the canonical shared form now lives in [shared-compiler-contracts.md](../../../docs/shared-compiler-contracts.md). Backend-family should reuse those contracts where they fit instead of redefining the same descriptor shape ad hoc.

## Schema Version: 0.1.0

---

## Companion Tooling

Current companion commands for this schema slice:

- `sdsl validate <entry.api.loj|entry.sdsl>`
- `sdsl build <entry.api.loj|entry.sdsl> --out-dir <dir>`
- `sdsl dev <entry.api.loj|entry.sdsl> [--out-dir <dir>]`

Current editor support in the repo:

- the shared VSCode extension registers `.api.loj` and legacy `.sdsl`
- project-backed diagnostics, hover, and inspect are implemented for backend-family source files
- generated-source trace is not implemented for backend-family source files yet

Example repo-native backend:

- `subprojects/sdsl/examples/user-service/app.api.loj`
- `subprojects/sdsl/examples/user-service/app.fastapi.api.loj`
- `npm run mvn:test --workspace=@loj/example-user-service` verifies the generated Spring Boot project, including generated CRUD endpoint tests
- `npm run py:compile:fastapi --workspace=@loj/example-user-service` syntax-smokes the generated FastAPI project
- `npm run py:test:fastapi --workspace=@loj/example-user-service` installs generated FastAPI dependencies into an example-scoped virtual environment and runs generated `pytest`

## File Structure

A backend-family source file (`.api.loj`, legacy `.sdsl`) is a **strict YAML subset**:

- no anchors
- no aliases
- no merge keys
- no custom tags

The backend-family `.api.loj` slice supports two project shapes:

- **Single-file app**: one root `.api.loj` file with `app:`, optional `compiler:`, and semantic definitions
- **Root-plus-modules app**: one root `.api.loj` file with optional `imports:` plus semantic module files, where imported modules may also import other modules

A single-file app is just a root file with no `imports:`.

Top-level keys in a **root file**:

| Key | Required | Description |
|-----|----------|-------------|
| `app:` | Yes | Backend project config such as app name and Java base package |
| `compiler:` | No | Code generation config; `v0.1` supports Spring Boot + Java + `mvc-jpa-security` and FastAPI + Python + `rest-sqlalchemy-auth` |
| `imports:` | No | Root-only list of additional backend-family module files |
| `model <Name>:` | No | Domain model definition |
| `resource <name>:` | No | CRUD REST resource bound to a model |
| `readModel <name>:` | No | Narrow named GET read-model/search surface |

Top-level keys in a **module file**:

| Key | Allowed | Description |
|-----|---------|-------------|
| `model <Name>:` | Yes | Domain model definition |
| `resource <name>:` | Yes | CRUD resource definition |
| `readModel <name>:` | Yes | Narrow named GET read-model/search surface |
| `imports:` | Yes | Optional transitive module links |
| `app:` | No | Root-only |
| `compiler:` | No | Root-only |

Current multi-file support is intentionally narrow:

- imports must be relative `.api.loj` / `.sdsl` file paths or relative directories ending with `/`
- nested imports are allowed
- import cycles are invalid and reported with an import chain
- imported definitions merge into one app-wide namespace
- there is still one canonical entry file with the only `app:` and `compiler:` blocks
- directory imports expand only direct child backend-family source files, sorted lexicographically

Duplicate model, resource, or readModel names across files are errors.

At least one semantic surface must exist:

- `resource <name>:` and/or `readModel <name>:`
- `model <Name>:` is required by `resource` blocks and optional for handler-only read-model services

Recommended default:

- small demos and prompt-sized backends: single file
- larger service definitions: split by domain with `imports:`

---

## `app:` Block

Use `app:` only for backend project identity and package layout.

```yaml
app:
  name: "User Service"                  # Required. Human-readable app name.
  package: "com.example.userservice"    # Required. Backend-family namespace / package root.
```

Rules:

- `name` is required
- `package` is required
- `package` must be a valid dotted Java package
- do not put auth providers, database vendor overrides, or business logic in `app:`

Generated project defaults in `v0.1` depend on the selected backend target/profile:

- Spring Boot + Java -> Maven + H2 local configuration
- FastAPI + Python -> `pyproject.toml` + SQLite local configuration

---

## `compiler:` Block

Use this block only for code generation settings.

```yaml
compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security
```

Rules in schema `0.1.0`:

- implemented valid target triples are:
  - `spring-boot / java / mvc-jpa-security`
  - `fastapi / python / rest-sqlalchemy-auth`
- `target`, `language`, and `profile` must form one of those implemented triples

If omitted, the compiler should behave as if `spring-boot / java / mvc-jpa-security` were selected.

This block exists so future schema versions can add:

- `language: kotlin`
- alternate Spring profiles
- alternate backend targets beyond FastAPI

Do not encode Java/Kotlin into `target`.

---

## `imports:` Block

Use `imports:` for explicit module links.

```yaml
imports:
  - ./models/user.api.loj
  - ./resources/users.api.loj
```

Rules:

- each entry must be either a relative `.api.loj` / `.sdsl` file path or a relative directory path ending with `/`
- import order does not change semantic meaning
- imported files share the same global namespace as the root file
- module files may contain their own `imports:`
- import cycles are invalid
- directory imports expand only direct child backend-family source files, in lexicographic path order
- directory imports are not recursive
- the root file may still keep local `model` and `resource` definitions

Recommended split heuristic:

- `1-3` models and `1-2` resources: keep one file
- `4+` models or `3+` resources: split by domain

---

## `model <Name>:` Block

Defines a domain model that will generate:

- a JPA entity
- request/response DTOs
- validation metadata

Example:

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, EDITOR, VIEWER)
  active: boolean
  createdAt: datetime @createdAt
```

Generated persistence identity is implicit:

```yaml
id: long   # Generated automatically. Do not declare it manually in v0.1.
```

### Field Types

| Type | Java | Description |
|------|------|-------------|
| `string` | `String` | Text field |
| `text` | `String` | Longer text field |
| `integer` | `Integer` | Whole number |
| `long` | `Long` | Larger whole number |
| `decimal` | `BigDecimal` | Decimal number |
| `boolean` | `Boolean` | True/false |
| `datetime` | `Instant` | Date/time |
| `date` | `LocalDate` | Calendar date |
| `enum(A, B, C)` | generated enum | Enumerated values |
| `belongsTo(Model)` | `Long` / related id | Narrow foreign-key relation to another model |
| `hasMany(Model, by: field)` | metadata only | Derived inverse relation metadata; no column or DTO field is generated yet |

### Field Decorators

| Decorator | Description |
|-----------|-------------|
| `@required` | Field must be present |
| `@email` | Must be valid email format |
| `@unique` | Generate uniqueness constraint |
| `@minLen(n)` | Minimum string length |
| `@maxLen(n)` | Maximum string length |
| `@createdAt` | Generated creation timestamp |
| `@updatedAt` | Generated update timestamp |

Rules:

- `@email` only applies to `string`
- `@minLen` and `@maxLen` only apply to `string` or `text`
- `@createdAt` and `@updatedAt` only apply to `datetime`
- `@unique` is a persistence concern, not a cross-resource query language
- `belongsTo(Model)` requires that `Model` exists
- `hasMany(Model, by: field)` requires that `Model` exists and `by:` points to a `belongsTo(CurrentModel)` field on the target model
- the current backend-family slice treats `belongsTo(...)` as a single foreign-key relation
- generated request/response DTOs expose the related record id, not an expanded nested object
- `hasMany(...)` is inverse metadata only; it does not create storage, entity fields, or request/response DTO fields
- `hasMany(...)` inverse fields do not support field decorators

Current non-goals:

- relation-aware projection on top of declared relations
- custom SQL/JPA annotations in source DSL
- manual primary key definitions

---

## `readModel <name>:` Block

Defines a narrow named GET read-model/search surface.

Example:

```yaml
readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureAirport: string @required
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
```

Narrow SQL escape example:

```yaml
readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@sql("./queries/flightAvailability")'
```

### Required Keys

| Key | Required | Description |
|-----|----------|-------------|
| `api:` | Yes | Exact GET route path |
| `result:` | Yes | Row/result shape |
| `handler:` | Yes | Target-language function-body snippet implementing the read-model |
| `auth:` | No | Whole-surface access mode/roles |
| `inputs:` | No | Query inputs; omit or keep empty for zero-input read-models |
| `rules:` | No | Narrow linked `.rules.loj` eligibility / derivation surface |

Rules:

- current read-models are intentionally narrow:
  - fixed `GET` route only
  - list result only
  - named surface only
  - no free-form join/query builder syntax
- `api` must start with `/`
- `auth:` reuses the same `mode` / `roles` shape as `resource auth`
- `readModel auth.policy` is not supported yet; keep access control to `mode` / `roles` plus local handler logic in the current slice
- `inputs:` and `result:` use the same field authoring shape as models, but the current read-model slice supports only scalar field types there
- current `inputs:` support only `@required`
- current `inputs:` do not support `datetime`; use `date` or `string` in this slice
- current `result:` fields do not support decorators
- `handler:` must use `@fn("./path")` or `@sql("./path")`
- extensionless logical ids are preferred for `handler:`
- current target/language resolution for `@fn(...)` uses `.java` for `spring-boot/java`, `.py` for `fastapi/python`, and `.kt` for future Spring Kotlin
- explicit `.java` / `.py` / `.kt` suffixes are accepted as deliberate `handler:` lock-in
- `@sql(...)` currently resolves to `.sql`
- `@sql(...)` is intentionally narrow:
  - read-model handlers only
  - file-backed query only; do not inline large SQL strings into `.api.loj`
  - read-only `SELECT` / `WITH` queries only
  - no stored procedures, `CALL`, or write-oriented SQL in this slice
  - result columns should be aliased to the declared `result:` field names
- `rules:` is optional and must use `@rules("./rules/x")`
- extensionless logical ids are preferred for `rules:`
- `rules:` currently supports only:
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- `rules:` currently rejects:
  - `allow/deny <operation>`
- `derive <field>` must target an existing `result:` field
- `derive <field>` currently supports only scalar result fields other than `date` / `datetime`
- `readModel` rules expressions currently allow:
  - `currentUser.id`, `currentUser.username`, `currentUser.role`, `currentUser.roles`
  - `input.<field>`
  - `item.<resultField>` inside derivations
  - bare uppercase tokens like `ADMIN`
- Spring generates a typed controller plus handler adapter and passes `PolicyPrincipal.fromAuthentication(authentication)` into the handler
- Spring read-model rules generate typed eligibility + validation + derivation helpers and run them around the handler input/output
- FastAPI generates a typed route plus handler adapter and passes either the authenticated principal or `None`
- FastAPI read-model rules generate typed eligibility + validation + derivation helpers and run them around the handler input/output
- handler snippets stay target-specific escape hatches; do not encode query-builder, ORM, or framework vocabulary into the DSL itself
- target-local ORM usage or raw SQL is acceptable inside handler snippets when needed, but it remains escape-hatch code rather than backend-family syntax
- do not treat raw SQL snippets as the default authoring path for CRUD/resources/read-models; if a query pattern repeats across targets, extract a primitive instead of normalizing SQL into the core DSL

Current handler snippet contract:

- the handler file is a target-language function-body snippet, not a full controller/service/module
- Spring handler snippets execute inside `List<ReadModelResult> execute(ReadModelInput input, PolicyPrincipal principal)`
- FastAPI handler snippets execute inside `def execute(db: Session, input: ReadModelInput, principal: AuthenticatedUser | None) -> list[ReadModelResult]`
- Spring handler adapters also inject `EntityManager` plus all generated repositories so local target-specific querying can stay inside the escape hatch

Current non-goals:

- generic query composition
- query pushdown DSL
- write semantics
- per-operation auth overrides
- frontend-family consumption of backend read-models
- a source-level SQL wrapper DSL or database-vendor keywords in core backend-family syntax

---

## `resource <name>:` Block

Binds a model to a REST API surface and generated security rules.

```yaml
resource users:
  model: User
  api: /api/users
  auth:
    mode: authenticated
    roles: [ADMIN]
  create:
    includes:
      - field: memberships
        fields: [role]
  operations:
    list: true
    get: true
    create: true
    update: true
    delete: true
```

### Required Keys

| Key | Required | Description |
|-----|----------|-------------|
| `model:` | Yes | Reference to a model name |
| `api:` | Yes | Base REST path |
| `auth:` | No | Security rules for this resource |
| `workflow:` | No | Narrow linked `.flow.loj` lifecycle surface |
| `create:` | No | Narrow aggregate-root nested create semantics |
| `update:` | No | Narrow aggregate-root one-level nested update/diff semantics |
| `operations:` | No | Which CRUD endpoints to generate |

### `auth:` Block

Use `auth:` to describe narrow policy intent, not Spring internals.

```yaml
auth:
  mode: authenticated   # "public" | "authenticated"
  roles: [ADMIN, SUPPORT]
  policy: '@fn("./policies/canManageUsers")'
```

Rules:

- `mode` defaults to `authenticated`
- if `mode: public`, `roles` must be omitted
- if `mode: public`, `policy` must also be omitted
- `roles` means “authenticated user must have one of these roles”
- role names should be uppercase identifiers without the `ROLE_` prefix
- `policy` is optional and runs in addition to built-in mode/role checks
- `policy` currently accepts either:
  - `@fn("./policies/canManageUsers")`
  - `@rules("./policies/order-access")`
- extensionless logical ids are preferred for both forms
- current target/language resolution for `@fn(...)` uses `.java` for `spring-boot/java`, `.py` for `fastapi/python`, and `.kt` for future Spring Kotlin
- explicit `.java` / `.py` / `.kt` suffixes are accepted as deliberate `@fn(...)` lock-in
- `@rules(...)` accepts an extensionless path or explicit `.rules.loj` suffix

### `workflow:`

Use `workflow:` to link one narrow `.flow.loj` lifecycle to a resource.

```yaml
workflow: '@flow("./workflows/booking-lifecycle")'
```

Rules:

- `workflow:` is optional and must use `@flow("./workflows/x")`
- extensionless logical ids are preferred for `workflow:`
- explicit `.flow.loj` suffixes are accepted as deliberate lock-in
- the linked workflow `model` must match the resource `model`
- the linked workflow `field` must point to an `enum(...)` field on that model
- the linked workflow must declare every enum value from that field, and every declared workflow state must exist in the enum
- Spring Boot and FastAPI both generate workflow-aware create/update wrappers for this slice:
  - create seeds the initial workflow state from the first `wizard.steps[].completesWith` when present, otherwise the first declared workflow state
  - update preserves the current workflow state rather than accepting direct state mutation through the normal update payload
  - a workflow-linked resource also gains `POST /.../{id}/transitions/{transition}` for transition enforcement
- backend-family generated workflow mutation paths are transactional by default in the current implemented targets:
  - Spring wraps workflow create/update/transition service paths in `@Transactional`
  - FastAPI wraps workflow create/update/transition service paths in one generated `Session` commit/rollback boundary
- authors do not need to add `transactional: true` to workflow-linked resources in the current slice
- transition `allow` expressions currently support only:
  - `currentUser.id`, `currentUser.username`, `currentUser.role`, `currentUser.roles`
  - `record.<field>`
  - bare uppercase enum-like literals such as `READY` or `TICKETED`
- `wizard.steps` are still authored in the shared workflow manifest; they may now also set optional `surface: form | read | workflow`, but backend route generation still consumes only the transition surface directly

Current non-goals:

- project-shell workflow orchestration
- generic long-transaction / saga syntax
- state-machine-library or transaction-framework vocabulary in source DSL

### `create:` Block

Use `create:` only for narrow aggregate-root nested create semantics.

```yaml
create:
  rules: '@rules("./rules/booking-create")'
  includes:
    - field: passengers
      fields: [name, seat]
```

Rules:

- current `create:` support is intentionally narrow:
  - one-level child collections only
  - direct `hasMany(..., by: ...)` relations only
- `rules:` is optional and must use `@rules("./rules/x")`
- extensionless logical ids are preferred for `rules:`
- `create.rules` currently supports only:
  - `eligibility <name>`
  - `validate <name>`
- `create.rules` currently rejects:
  - `allow/deny <operation>`
  - `derive <field>`
- `create.rules` expressions currently allow:
  - `currentUser.id`, `currentUser.username`, `currentUser.role`, `currentUser.roles`
  - `payload.<field>`
  - `params.<name>`
  - bare uppercase tokens like `ADMIN`
- `includes:` entries must reference direct `hasMany(Target, by: field)` model fields on the resource model
- `fields:` entries must name fields on the related target model
- the inverse `by:` field is seeded automatically and must not be listed again
- child `fields:` may currently use scalar, enum, or `belongsTo(...)` target-model fields
- child `fields:` may not use `hasMany(...)`
- Spring generates a resource-scoped nested create DTO plus transactional child persistence
- Spring `create.rules` generate typed eligibility + validation helpers, with eligibility failures surfaced as `403` and validation failures as `400`
- FastAPI generates a resource-scoped nested create schema plus one-commit child persistence
- FastAPI `create.rules` generate typed eligibility + validation helpers, with eligibility failures surfaced as `403` and validation failures as `400`
- backend-family generated create paths are transactional by default in the current implemented targets:
  - Spring wraps generated create service paths in `@Transactional`
  - FastAPI wraps generated create service paths in one generated `Session` commit/rollback boundary
- authors do not need to add `transactional: true` to ordinary generated create paths in the current slice

Current non-goals:

- deeper child nesting
- ORM-specific cascade vocabulary in source DSL

### `update:` Block

Use `update:` only for narrow aggregate-root one-level nested update/diff semantics.

```yaml
update:
  includes:
    - field: passengers
      fields: [name, seat]
```

Rules:

- current `update:` support is intentionally narrow:
  - one-level child collections only
  - direct `hasMany(..., by: ...)` relations only
  - `operations.update` must remain enabled
- `includes:` entries must reference direct `hasMany(Target, by: field)` model fields on the resource model
- `fields:` entries must name fields on the related target model
- the inverse `by:` field is seeded automatically and must not be listed again
- child `fields:` may currently use scalar, enum, or `belongsTo(...)` target-model fields
- child `fields:` may not use `hasMany(...)`
- incoming child items with `id` update matching existing children that already belong to the parent record
- incoming child items without `id` create new children under that parent record
- existing children omitted from the submitted collection are deleted
- Spring generates a resource-scoped nested update DTO plus transactional one-level child sync
- FastAPI generates a resource-scoped nested update schema plus one-commit one-level child sync
- backend-family generated update/delete paths are transactional by default in the current implemented targets:
  - Spring wraps generated update/delete service paths in `@Transactional`
  - FastAPI wraps generated update/delete service paths in one generated `Session` commit/rollback boundary
- authors do not need to add `transactional: true` to ordinary generated update/delete paths in the current slice

Current non-goals:

- deeper child nesting
- nested update/diff beyond one child collection layer
- ORM-specific cascade vocabulary in source DSL

Current policy snippet contract:

- the policy file is a target-language function-body snippet, not a full controller/service file
- it must return a boolean
- it may use:
  - `principal`
  - `operation`
  - `params`
  - `payload`

Spring example snippet:

```java
return principal.hasRole("ADMIN") && !"delete".equals(operation);
```

FastAPI example snippet:

```python
return "ADMIN" in principal.roles and operation != "delete"
```

Current linked rules contract:

```yaml
auth:
  mode: authenticated
  roles: [ADMIN, SALES]
  policy: '@rules("./policies/invoice-access")'
```

- linked `.rules.loj` files compile to target-native backend enforcement plus the shared rules manifest
- current backend-linked rules context is intentionally narrow:
  - `currentUser.id` and `currentUser.username` resolve to the authenticated username
  - `currentUser.role` resolves to the current primary role
  - `currentUser.roles` resolves to the current role collection
  - `record.<field>` / `record.id`
  - `payload.<field>`
  - `params.<name>`
  - bare uppercase tokens like `ADMIN` / `COMPLETED` are treated as enum-like literals
- list `scopeWhen` / `scope` currently compile to generated in-memory filtering in the controller/route layer, not query pushdown
- linked rules remain resource-level only; per-operation `auth:` overrides are still not part of `v0.1`

Current linked create-rules contract:

```yaml
create:
  rules: '@rules("./rules/booking-create")'
```

- linked `.rules.loj` files compile to target-native create eligibility + validation helpers
- only `eligibility <name>` and `validate <name>` are consumed in this slice
- `allow/deny` and `derive` entries are validation errors here

Current linked read-model-rules contract:

```yaml
readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    passengerCount: integer @required
  result:
    basePrice: decimal
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
  rules: '@rules("./rules/flight-availability")'
```

- linked `.rules.loj` files compile to target-native read-model eligibility + validation + derivation helpers
- only `eligibility <name>`, `validate <name>`, and `derive <field>` are consumed in this slice
- `allow/deny` entries are validation errors here

Current constraint:

- `auth` applies to the whole resource
- per-operation auth overrides are not part of `v0.1`
- custom backend escape hatches keep their own transaction boundary:
  - `@fn(...)` does not get an extra generated transaction wrapper beyond whatever the local target code already does
  - `@sql(...)` is currently read-model-only and read-only, so it does not participate in generated write transactions

### `operations:` Block

Controls which CRUD endpoints are generated.

```yaml
operations:
  list: true
  get: true
  create: true
  update: true
  delete: true
```

Defaults:

- if `operations:` is omitted, all five operations default to `true`

Rules:

- `list` generates `GET /api/...`
- `get` generates `GET /api/.../{id}`
- `create` generates `POST /api/...`
- `update` generates `PUT /api/.../{id}`
- `delete` generates `DELETE /api/.../{id}`

If an operation is `false`, that endpoint must not be generated.

---

## Generated HTTP Contract

SpringDSL must align to the repo-level transport contract in `docs/loj-transport-contract.md`.

For the first generated Spring Boot backend, the recommended canonical envelopes are:

### List

```json
{
  "items": [
    { "id": 1, "name": "Ada", "email": "ada@example.com" }
  ]
}
```

### Single Record

```json
{
  "item": { "id": 1, "name": "Ada", "email": "ada@example.com" }
}
```

### Error

```json
{
  "message": "Validation failed"
}
```

Rules:

- all returned records must expose `id`
- `id` may be numeric in backend transport; current frontend runtimes may coerce it to string
- `DELETE` may return `204 No Content`
- do not generate framework-default HTML error pages for API routes
- current backend-family source does not define message templating or descriptor syntax; keep API errors to a stable human-readable `message`

Important current constraint:

- server-driven pagination metadata is **not** required in `v0.1`
- do not require `total`, `page`, or `pageSize` for the first SpringDSL slice

If richer pagination or richer error/i18n envelopes become necessary later, they must be added to the shared transport contract first.

---

## Validation Semantics

Validation exists at two layers:

- compiler-time DSL validation
- runtime validation in generated Spring code

The first SpringDSL slice should generate Bean Validation metadata from model decorators.

Examples:

- `@required` -> non-null / non-blank validation
- `@email` -> email validation
- `@minLen(2)` -> minimum size validation

Current non-goals:

- cross-resource validation rules
- arbitrary validation expressions
- custom validation classes referenced directly from DSL

---

## What Is NOT Supported In `v0.1`

Not supported by design:

- frontend `page` blocks
- custom query DSL
- arbitrary custom controller methods
- generic relation query DSL beyond narrow `belongsTo(...)`, inverse `hasMany(..., by: ...)`, and one-level `resource create.includes` / `resource update.includes`
- method-level auth expressions
- OAuth/JWT provider configuration in source DSL
- Kotlin
- Gradle
- WebFlux
- GraphQL
- background jobs or messaging
- OpenAPI-first authoring
- project-shell workflow orchestration or generic long-transaction syntax

If you need one of these, do not invent ad hoc syntax. Extend the contract first.

---

## Complete Example

```yaml
app:
  name: "User Service"
  package: "com.example.userservice"

compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, EDITOR, VIEWER)
  active: boolean
  createdAt: datetime @createdAt

resource users:
  model: User
  api: /api/users
  auth:
    mode: authenticated
    roles: [ADMIN]
  operations:
    list: true
    get: true
    create: true
    update: true
    delete: true
```

This file is intended to generate a runnable Spring Boot CRUD backend with:

- JPA entity + repository
- service layer
- REST controller
- Bean Validation
- Spring Security role gate
- H2-backed local example configuration

---

## Authoring Guidance

Use backend-family source (`.api.loj`, legacy `.sdsl`) when you want:

- a generated Spring Boot CRUD backend
- narrow REST resources
- generated persistence and validation
- generated role-based protection

Do **not** use backend-family source files to describe:

- frontend layout
- full-stack orchestration
- shared cross-target models
- provider-specific infrastructure

Those belong in:

- `.web.loj` / legacy `.rdsl`
- `loj.project.yaml`
- future repo-level shared-schema contracts
