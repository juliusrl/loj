# @loj-lang/sdsl-cli

Target-local CLI for `.api.loj` backend-family projects (legacy alias: `.sdsl`).

Current implemented commands:

- `sdsl validate`
- `sdsl build`
- `sdsl dev`

This CLI currently drives Spring Boot and FastAPI targets from the same backend-family source semantics.

Local workspace commands:

```bash
npm run build --workspace=@loj-lang/sdsl-cli
npm run test --workspace=@loj-lang/sdsl-cli
```
