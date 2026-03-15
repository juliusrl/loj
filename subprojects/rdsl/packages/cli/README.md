# @loj-lang/rdsl-cli

Target-local CLI for legacy `.rdsl` projects.

Current implemented commands:

- `rdsl validate`
- `rdsl build`
- `rdsl dev`
- `rdsl inspect`
- `rdsl trace`
- `rdsl host export-react`
- `rdsl host sync-react`

Machine-readable contract:

- `--json` outputs use stable artifact-shaped envelopes with `artifact` and `schemaVersion`

Local workspace commands:

```bash
npm run build --workspace=@loj-lang/rdsl-cli
npm run test --workspace=@loj-lang/rdsl-cli
```
