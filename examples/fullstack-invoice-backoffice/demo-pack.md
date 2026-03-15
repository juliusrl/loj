# Invoice Demo Pack

This is the current minimal visual/demo pack source for the invoice back-office showcase.

It is intentionally narrow:

- automated screenshot capture
- one shortest-path evaluator command
- automatically derived motion assets when local video tooling is available
- one repo-embedded outward-facing preview page derived from the latest demo-pack

## Commands

Spring-backed screenshots:

```bash
npm run demo-pack --workspace=@loj/example-fullstack-invoice-backoffice
```

FastAPI-backed screenshots:

```bash
npm run demo-pack:fastapi --workspace=@loj/example-fullstack-invoice-backoffice
```

Default output:

```text
examples/fullstack-invoice-backoffice/.artifacts/demo-pack/
```

Current output set:

- `01-invoices-list.png`
- `02-invoice-read.png`
- `03-customer-invoices-page.png`
- `04-team-read.png`
- `invoice-walkthrough.webm`
- `invoice-walkthrough.mp4` when `ffmpeg` is available
- `invoice-walkthrough.gif` when `ffmpeg` is available
- `summary.json`
- `playwright-trace.zip`

Published outward-facing preview set:

- `docs/public-proof-preview.md`
- `docs/public-proof-assets/invoice-backoffice/`

## Evaluator Path

If someone wants the shortest public proof path today:

1. `npm install`
2. `npm run demo:loj:invoice:proof`

That gives:

- generated full-stack output
- a stronger relation-heavy vertical than user-admin CRUD
- a linked `.rules.loj` proof already wired into backend enforcement
- a repeatable screenshot set, trace, and short motion asset instead of doc-only evaluation
- a repo-embedded preview page that reuses those published assets without requiring readers to build locally first
