# Full-Stack Invoice Back Office Example

This example is the first stronger public-facing showcase vertical beyond the repo's original
user-admin CRUD path.

It keeps the current repo boundaries on purpose:

- frontend-family `.web.loj` reuses the implemented relation slice
- backend-family `.api.loj` reuses the implemented CRUD/auth slice
- linked `.rules.loj` is wired only through backend `resource auth.policy`
- the same project shell switches the backend target from Spring Boot to FastAPI

If you only want the shortest evaluator path from the repo root:

```bash
npm install
npm run demo:loj:invoice:proof
```

That one command currently builds the linked rules manifest, builds the Spring full-stack project,
and captures the screenshot set, Playwright trace, and motion assets under `.artifacts/demo-pack/`.
It also republishes the stable repo-embedded preview at [../../docs/public-proof-preview.md](../../docs/public-proof-preview.md).

This example proves a denser back-office story with:

- teams -> customers -> invoices -> invoice line items
- relation-aware list/read/panel/page-block surfaces
- a real linked backend rules file at `backend/resources/policies/invoice-access.rules.loj`
- one-command multi-target full-stack generation through `loj.project.yaml`

## Files

- `frontend/` — local frontend-family source for the invoice back-office app
- `backend/` — local backend-family source for Spring and FastAPI variants
- `backend/resources/policies/invoice-access.rules.loj` — linked backend policy proof
- `loj.project.yaml` — Spring Boot backend variant
- `loj.fastapi.project.yaml` — FastAPI backend variant
- `.env` — checked-in local demo defaults for proxy auth and non-conflicting dev ports

Generated output stays local and is not committed:

- `generated/frontend/`
- `generated/backend/`
- `generated/backend-fastapi/`
- `generated/rules/`

## Commands

```bash
# Validate the Spring-backed full-stack project
npm run validate --workspace=@loj/example-fullstack-invoice-backoffice

# Build generated frontend + Spring backend output
npm run build:generated --workspace=@loj/example-fullstack-invoice-backoffice

# Watch and run the Spring-backed variant locally
npm run dev --workspace=@loj/example-fullstack-invoice-backoffice

# Validate the FastAPI-backed project
npm run validate:fastapi --workspace=@loj/example-fullstack-invoice-backoffice

# Build generated frontend + FastAPI backend output
npm run build:generated:fastapi --workspace=@loj/example-fullstack-invoice-backoffice

# Watch and run the FastAPI-backed variant locally
npm run dev:fastapi --workspace=@loj/example-fullstack-invoice-backoffice

# Validate the standalone rules file
npm run validate:rules --workspace=@loj/example-fullstack-invoice-backoffice

# Emit the standalone rules manifest
npm run build:rules --workspace=@loj/example-fullstack-invoice-backoffice

# Republish the repo-embedded preview from the latest demo-pack
npm run publish-preview --workspace=@loj/example-fullstack-invoice-backoffice

# Run the full evaluator path: rules manifest + Spring build + demo pack
npm run proof --workspace=@loj/example-fullstack-invoice-backoffice

# Capture the Spring-backed screenshot set plus motion assets
npm run demo-pack --workspace=@loj/example-fullstack-invoice-backoffice

# Capture the FastAPI-backed screenshot set plus motion assets
npm run demo-pack:fastapi --workspace=@loj/example-fullstack-invoice-backoffice
```

Recommended evaluator path:

1. `npm run demo:loj:invoice:proof`
2. open [../../docs/public-proof-preview.md](../../docs/public-proof-preview.md)

Expanded manual path if you want to inspect each stage:

1. `npm run validate:rules --workspace=@loj/example-fullstack-invoice-backoffice`
2. `npm run validate --workspace=@loj/example-fullstack-invoice-backoffice`
3. `npm run build:generated --workspace=@loj/example-fullstack-invoice-backoffice`
4. `npm run validate:fastapi --workspace=@loj/example-fullstack-invoice-backoffice`
5. `npm run build:generated:fastapi --workspace=@loj/example-fullstack-invoice-backoffice`
6. `npm run demo-pack --workspace=@loj/example-fullstack-invoice-backoffice`

Before the first `npm run dev`, make sure the shared React host has its local dependencies installed:

```bash
npm run ci:install-rdsl-host-deps
```

Local dev defaults come from `.env`:

- frontend host: `http://127.0.0.1:5175`
- frontend preview: `http://127.0.0.1:4175`
- backend server: `http://127.0.0.1:3003`
- local proxy auth: `admin / admin123`

The generated backend auth and the linked rules file are intentionally still narrow. This example is
meant to show a more believable back-office vertical without pretending the repo already has generic
query DSLs, workflow DSLs, or broad policy management UI.

## Demo Pack

The current visual proof path lives in [demo-pack.md](../../examples/fullstack-invoice-backoffice/demo-pack.md).
The current outward-facing embedded preview lives in [../../docs/public-proof-preview.md](../../docs/public-proof-preview.md).

It captures a repeatable screenshot set plus motion assets into:

```text
.artifacts/demo-pack/
```

The generated summary lives at:

```text
.artifacts/demo-pack/summary.json
```

Published preview assets are synced to:

```text
../../docs/public-proof-assets/invoice-backoffice/
```

Current screenshots cover:

- invoices list
- invoice read with related line items
- record-scoped customer invoices page
- team read with related customers panel

Current motion assets:

- `invoice-walkthrough.webm`
- `invoice-walkthrough.mp4`
- `invoice-walkthrough.gif`
