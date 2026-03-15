# Backend-Family User Service Example

This example demonstrates the current multi-file backend-family `.api.loj` slice.

The same `models/` and `resources/` modules can be compiled to two backend targets today:

- Spring Boot + Java via [app.api.loj](../../../../subprojects/sdsl/examples/user-service/app.api.loj)
- FastAPI + Python via [app.fastapi.api.loj](../../../../subprojects/sdsl/examples/user-service/app.fastapi.api.loj)

Legacy backend-family aliases remain available during the current beta cycle:

- [app.sdsl](../../../../subprojects/sdsl/examples/user-service/app.sdsl)
- [app-fastapi.sdsl](../../../../subprojects/sdsl/examples/user-service/app-fastapi.sdsl)

## Files

- `app.api.loj` — recommended Spring-target root file with `app:` and project imports
- `app.fastapi.api.loj` — recommended FastAPI-target root file
- `models/` — domain model modules
- `resources/` — REST resource modules

## Commands

```bash
# Validate the Spring target entry
npm run validate --workspace=@loj/example-user-service

# Generate a Spring Boot + Java + Maven project into generated/ (local output, not checked in)
npm run build:generated --workspace=@loj/example-user-service

# Run Maven smoke tests against generated output, including generated CRUD endpoint tests
npm run mvn:test --workspace=@loj/example-user-service

# Start the generated Spring Boot app
npm run mvn:run --workspace=@loj/example-user-service

# Validate the FastAPI target entry
npm run validate:fastapi --workspace=@loj/example-user-service

# Generate a FastAPI + Python project into generated-fastapi/ (local output, not checked in)
npm run build:generated:fastapi --workspace=@loj/example-user-service

# Syntax-smoke the generated Python files without installing dependencies
npm run py:compile:fastapi --workspace=@loj/example-user-service

# Install generated dependencies into an example-scoped venv and run generated pytest CRUD tests
npm run py:test:fastapi --workspace=@loj/example-user-service
```

The generated projects are not committed; use the build scripts to materialize them locally.
