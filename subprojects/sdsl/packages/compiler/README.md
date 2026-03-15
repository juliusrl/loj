# @loj-lang/sdsl-compiler

Backend-family compiler for legacy `.sdsl` sources.

Current implemented targets:

- `spring-boot / java / mvc-jpa-security`
- `fastapi / python / rest-sqlalchemy-auth`

Shared backend-family primitives stay target-neutral where possible:

- `model`
- `resource`
- `api`
- `auth`
- `operations`

Local workspace commands:

```bash
npm run build --workspace=@loj-lang/sdsl-compiler
npm run test --workspace=@loj-lang/sdsl-compiler
```
