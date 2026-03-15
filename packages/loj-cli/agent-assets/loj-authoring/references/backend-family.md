# Backend-Family Authoring (`.api.loj`, legacy `.sdsl`)

Use this reference when authoring or reviewing backend-family source files.

## Defaults

- Prefer `.api.loj` for new files. Use `.sdsl` only for legacy edits.
- Files are a strict YAML subset:
  - no anchors
  - no aliases
  - no merge keys
  - no custom tags

Implemented compiler triples today:

- `spring-boot / java / mvc-jpa-security`
- `fastapi / python / rest-sqlalchemy-auth`

If `compiler:` is omitted, default is the Spring triple above.

## File Shape

Root files may contain:

- `app:`
- optional `compiler:`
- optional `imports:`
- `model <Name>:`
- `resource <name>:`
- `readModel <name>:`

Module files may contain:

- optional `imports:`
- `model <Name>:`
- `resource <name>:`
- `readModel <name>:`

Module files may not contain `app:` or `compiler:`.

## Imports

- Use single-file for small demos.
- Split by domain only when the service grows.
- `imports:` entries must be relative `.api.loj` / `.sdsl` paths or directories ending in `/`.
- Nested imports are allowed.
- Import cycles are invalid.
- Directory imports expand direct child family files only, sorted lexicographically.

## `app:`

```yaml
app:
  name: "Booking Service"
  package: "com.example.booking"
```

Rules:

- `name` is required
- `package` is required
- `package` must be a valid dotted Java-style package root
- do not place auth provider, database vendor, shutdown, proxy, or deploy details here

## `compiler:`

```yaml
compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security
```

Rules:

- `target`, `language`, and `profile` must form an implemented triple
- do not encode language into `target`
- `compiler:` is for generation target selection, not business semantics

## `model <Name>:`

Example:

```yaml
model Booking:
  reference: string @required @unique
  baseFare: decimal @required
  travelDate: date @required
  status: enum(DRAFT, READY, CONFIRMED, FAILED)
  memberId: belongsTo(Member)
  passengers: hasMany(Passenger, by: bookingId)
  createdAt: datetime @createdAt
  updatedAt: datetime @updatedAt
```

Types:

- `string`
- `text`
- `integer`
- `long`
- `decimal`
- `boolean`
- `datetime`
- `date`
- `enum(A, B, C)`
- `belongsTo(Model)`
- `hasMany(Model, by: field)`

Decorators:

- `@required`
- `@email`
- `@unique`
- `@minLen(n)`
- `@maxLen(n)`
- `@createdAt`
- `@updatedAt`

Implicit persistence identity:

```yaml
id: long
```

Do not declare `id` manually in `v0.1`.

Relation rules:

- `belongsTo(Model)` is supported for narrow foreign-key-style relations
- `hasMany(Model, by: field)` is inverse metadata only
- `hasMany(..., by: ...)` must point to a target-model field declared as
  `belongsTo(CurrentModel)`
- current backend-family relation support is metadata plus generated foreign-key handling; it is not
  a query DSL

## `readModel <name>:`

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
    flightNo: string
    quotedFare: decimal
  handler: '@sql("./queries/flightAvailability")'
  rules: '@rules("./rules/flight-availability")'
```

Rules:

- current read-models are narrow named GET list surfaces, not a generic query DSL
- `api` is required and must start with `/`
- `inputs:` and `result:` reuse model-style field authoring, but currently support scalar and enum
  field shapes only
- current `inputs:` support only `@required`
- current `inputs:` do not support `datetime`
- current `result:` fields do not support decorators
- `auth:` currently supports only `mode` / `roles`
- `handler:` is required and must use `@fn("./path")` or `@sql("./path")`
- extensionless logical ids are preferred; target resolution uses `.java` for Spring and `.py` for
  FastAPI
- `@sql(...)` is read-model-only and intentionally narrow:
  - file-backed query only
  - read-only `SELECT` / `WITH`
  - no procedures, `CALL`, `EXEC`, or write SQL
  - alias columns to declared `result:` field names
- `rules:` is optional and must use `@rules("./rules/x")`
- current read-model rules support only:
  - `eligibility`
  - `validate`
  - `derive`
- `allow/deny` entries are rejected on backend read-model linkage
- read-model rule expressions currently allow:
  - `currentUser.*`
  - `input.<field>`
  - `item.<resultField>` inside derivations
  - bare uppercase literals like `ADMIN`

## `resource <name>:`

Example:

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  auth:
    mode: authenticated
    roles: [AGENT, ADMIN]
  create:
    rules: '@rules("./rules/booking-create")'
    includes:
      - field: passengers
        fields: [name, seat]
  update:
    includes:
      - field: passengers
        fields: [id, name, seat]
  workflow: '@flow("./workflows/booking-lifecycle")'
  operations:
    list: true
    get: true
    create: true
    update: true
    delete: true
```

Current resource rules:

- `model` and `api` are required
- `auth.policy` may use `@fn("./policies/x")` or `@rules("./policies/x")`
- `create.rules` may use `@rules("./rules/x")`
- `create.rules` currently supports only:
  - `eligibility`
  - `validate`
- `create.rules` rejects:
  - `allow/deny`
  - `derive`
- `create.includes` / `update.includes` are the current one-level aggregate-root nested-write slice
- they accept only direct `hasMany(Target, by: field)` relations
- child `fields:` must belong to the target model
- the inverse `by:` field is seeded automatically and must not be listed again
- child `fields:` may currently use scalar, enum, or `belongsTo(...)`
- child `fields:` may not use `hasMany(...)`
- `update.includes` one-level diff semantics are:
  - child items with `id` update existing children under the parent
  - child items without `id` create new children
  - omitted existing children are deleted

Current `workflow:` rules:

- `workflow:` is optional and must use `@flow("./workflows/x")`
- extensionless logical ids are preferred for `workflow:`
- the linked workflow `model` must match the resource model
- the linked workflow `field` must point to an `enum(...)` field on that model
- the linked workflow must declare every enum value from that field, and every declared workflow
  state must exist in that enum
- generated workflow mutation paths add transition enforcement endpoints and preserve state on normal
  update payloads

## Transaction Rule

Generated backend write paths are transactional by default in the implemented targets:

- `resource create`
- `resource update`
- `resource delete`
- nested `create.includes` / `update.includes`
- workflow-linked create/update/transition paths

Current target behavior:

- Spring -> `@Transactional`
- FastAPI -> one generated `Session` commit/rollback boundary

Authors do not need and should not invent `transactional: true` in source DSL.

Custom escape hatches keep their own transaction boundary:

- `@fn(...)` is responsible for itself
- `@sql(...)` is read-model-only and read-only today

## Backend Escape Hatches

Use escape hatches only when the current `.api.loj` slice cannot express the behavior directly.

### `readModel handler: '@fn("./handlers/x")'`

Use `@fn(...)` for target-local query logic that is too specific for the shared read-model slice.

Rules:

- the handler file is a target-language function-body snippet, not a full controller/service/module
- extensionless logical ids are preferred
- Spring resolves to `.java`
- FastAPI resolves to `.py`

Current snippet contract:

- Spring executes inside:
  - `List<ReadModelResult> execute(ReadModelInput input, PolicyPrincipal principal)`
- FastAPI executes inside:
  - `def execute(db: Session, input: ReadModelInput, principal: AuthenticatedUser | None) -> list[ReadModelResult]`

Current file-shape rule:

- backend `@fn(...)` read-model handlers are function-body snippets
- do not include package declarations, imports, class declarations, or outer function declarations
- write only the body that runs inside the generated adapter function

Keep handler code target-local:

- use repositories / ORM / raw SQL as needed inside the snippet
- do not try to invent backend-family query-builder syntax around it

### `readModel handler: '@sql("./queries/x")'`

Use `@sql(...)` only for narrow read-only read-model handlers.

Rules:

- file-backed only; do not inline large SQL strings into `.api.loj`
- read-only `SELECT` / `WITH` only
- no procedures, `CALL`, `EXEC`, or write SQL
- alias result columns to the declared `result:` field names
- Spring gets a generated `NamedParameterJdbcTemplate` adapter
- FastAPI gets a generated `sqlalchemy.text(...)` adapter

### `auth.policy: '@fn(...)'`

Use `@fn(...)` for target-local auth decisions that cannot be expressed by `mode` / `roles` or the
current `.rules.loj` slice.

Keep it narrow:

- it is an additional policy check, not a replacement for the whole resource contract
- it keeps its own local transaction/runtime behavior
- policy snippets are also function-body snippets in the current backend-family targets
- do not include package/import/class/function declarations there either

## Commands

- `sdsl validate <entry.api.loj>`
- `sdsl build <entry.api.loj> --out-dir <dir>`

Use `loj.project.yaml` instead when you need project-shell database/runtime profiles, auto-provision,
shutdown/probe/cors/base-path handling, or coordinated `dev/status/doctor`.

## Guardrails

- Do not invent generic query composition or generic SQL DSL around `readModel`.
- Do not move database vendors or server runtime/deploy settings into `.api.loj`.
- Do not leak Spring/FastAPI framework vocabulary into source DSL.
