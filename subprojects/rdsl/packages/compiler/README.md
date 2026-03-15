# @loj-lang/rdsl-compiler

Frontend-family compiler for `.web.loj` sources (legacy alias: `.rdsl`).

Current implemented target:

- `react / typescript`

Core stages:

- parse
- normalize
- validate
- generate
- semantic manifest
- trace manifest

Local workspace commands:

```bash
npm run build --workspace=@loj-lang/rdsl-compiler
npm run test --workspace=@loj-lang/rdsl-compiler
```
