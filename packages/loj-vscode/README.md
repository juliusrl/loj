# Loj VSCode Extension

VSCode extension for Loj business-system DSL authoring.

Current implemented editor surface:

- `.web.loj`, `.api.loj`, `*.rules.loj`, `*.flow.loj`, `*.style.loj`, and `*.project.yaml` syntax highlighting
- project-backed diagnostics
- hover and inspect commands
- `.rdsl` trace entrypoints and linked-artifact navigation
- semantic-state status bar and current-issue navigation
- project-level `Start Dev` / `Debug` / `Stop` commands over `loj.project.yaml`
- project-level `Rebuild Target` / `Restart Service` commands that reuse the active `loj dev` session instead of restarting the whole loop
- project `status` / `doctor` / overview commands backed by `@loj-lang/cli`, with overview now exposed as a lightweight quick-pick summary over the same shared service/database-aware project-shell payload
- a dedicated Loj activity-bar icon with a lightweight `Project Controls` sidebar view for the most common dev/status/doctor/preview/rebuild actions
- lightweight skill actions in the same sidebar for installing the bundled `loj-authoring` skill into Codex or Windsurf, exporting a bundle, or opening the public `SKILL.md`
- quick navigation commands for nearest `loj.project.yaml`, linked `@rules/@flow/@sql` files, and the current target's generated output root
- preview command that opens the current frontend host URL, backend URL, or generated health/readiness/drain probe URLs from the shared `loj status` payload
- debugger attach command that reuses `loj dev --debug` / `loj status` to attach VSCode to generated Spring or FastAPI backends
- lightweight status-bar buttons for `Dev` / `Debug` / `Stop` when the active file sits under a `loj.project.yaml`

Current scope is intentionally narrow:

- authoring support for the public Loj source surfaces
- project-shell orchestration over `loj.project.yaml`
- lightweight inspection and navigation over generated relationships

This extension is not a generic low-code dashboard. It is a focused authoring companion for the current Loj alpha.

Local workspace commands:

```bash
npm run build --workspace=packages/loj-vscode
npm run test --workspace=packages/loj-vscode
cd packages/loj-vscode && vsce package --no-dependencies
```

Release install:

- Download `loj-vscode-0.5.1.vsix` from the GitHub release assets
- In VSCode run `Extensions: Install from VSIX...`
