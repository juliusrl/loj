# Backend Targets: Spring Boot And FastAPI

Use this reference when the task depends on the selected backend target rather than the shared
`.api.loj` syntax.

## Implemented Triples

### Spring

```yaml
compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security
```

### FastAPI

```yaml
compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth
```

No other backend-family target triple is implemented today.

## Shared Rule

Both targets reuse the same backend-family source primitives:

- `app`
- `compiler`
- `imports`
- `model`
- `resource`
- `readModel`
- linked `.rules.loj`
- linked `.flow.loj`

Do not fork source syntax just because the target changes.

## Spring Boot Target

Current stack:

- Spring Boot
- Java
- Spring MVC
- Spring Data JPA
- Spring Security
- Maven

Generated output typically includes:

- `src/main/java/.../Application.java`
- `controller/`
- `service/`
- `repository/`
- `domain/`
- `dto/`
- generated runtime helpers/config
- `src/test/java/...`
- `pom.xml`
- `application.properties`

Current target behavior:

- local default database profile is still H2 unless project-shell `database:` overrides it
- generated mutation paths are transactional by default with `@Transactional`
- linked `@sql("./queries/x")` read-model handlers generate a `NamedParameterJdbcTemplate` adapter
- project-shell `runtime` may rewrite graceful shutdown, probe endpoints, CORS, forwarded headers,
  trusted-proxy behavior, request-size limits, and backend `basePath`

## FastAPI Target

Current stack:

- FastAPI
- Python
- SQLAlchemy `Session`
- pytest

Generated output typically includes:

- `app/main.py`
- `app/config.py`
- `app/db.py`
- `app/security.py`
- `app/models/*.py`
- `app/schemas/*.py`
- `app/routes/*.py`
- `app/services/*.py`
- generated runtime middleware/helpers
- `tests/test_*_api.py`
- `pyproject.toml`

Current target behavior:

- local default database profile is still SQLite unless project-shell `database:` overrides it
- generated mutation paths are transactional by default through explicit `Session` commit/rollback
  boundaries
- linked `@sql("./queries/x")` read-model handlers generate a `sqlalchemy.text(...)` adapter
- project-shell `runtime` may rewrite lifespan/debug runner/proxy-header/request-size behavior and
  backend `root_path`

## Database Rule

Database choice is not a core `.api.loj` primitive.

It currently belongs to:

- target/profile defaults
- or project-shell `targets.<alias>.database`

Do not add database vendors to `.api.loj` source.

## Auth Rule

Auth in source DSL stays narrow:

```yaml
auth:
  mode: authenticated
  roles: [ADMIN]
```

Target implementation differences stay target-side:

- Spring -> Spring Security configuration and principal adapters
- FastAPI -> dependency-based auth wiring and current-user injection

Do not leak framework-specific auth details into source DSL.

## Transport Alignment

Both targets align to the same neutral transport baseline:

- list: raw array or `{ items: [...] }` or `{ data: [...] }`
- item: raw object or `{ item: {...} }` or `{ data: {...} }`
- error: JSON object with string `message`
- returned records include `id`
- server pagination metadata is still optional

## Escape-Hatch Direction

Current backend-family escapes are broader than the old auth-only slice.

Supported today:

- `resource auth.policy: '@fn("./policies/x")'`
- `resource auth.policy: '@rules("./policies/x")'`
- `resource create.rules: '@rules("./rules/x")'`
- `readModel rules: '@rules("./rules/x")'`
- `resource workflow: '@flow("./workflows/x")'`
- `readModel handler: '@fn("./handlers/x")'`
- `readModel handler: '@sql("./queries/x")'`

Rules:

- prefer extensionless logical ids first
- Spring resolves logical ids to `.java`
- FastAPI resolves logical ids to `.py`
- `.sql` stays explicit and file-backed
- explicit suffixes are deliberate target lock-in, not the default style

## Target Guardrails

- Do not invent Spring/FastAPI-specific DSL keys.
- Do not move transactions, database vendors, proxy behavior, or graceful shutdown into `.api.loj`.
- Keep target/runtime/deploy intent in `loj.project.yaml`.
