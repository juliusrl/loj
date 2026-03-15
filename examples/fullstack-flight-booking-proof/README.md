# Full-Stack Flight Booking Proof Example

This example is the first repo-local combination proof aimed directly at the current ATRS-core gate.

It does not try to recreate legacy ATRS stack details. It only combines the generic primitives that
already exist in the language family:

- named read-model search
- shared read-model rules on frontend and backend
- aggregate-root nested create/update with repeated child rows
- linked resource workflow with wizard-step summaries
- wizard-step surface handoff plus generated confirm/review and redo/back across generated form/read/workflow surfaces
- member CRUD plus booking-history read surfaces

Current source layout:

- `frontend/` — local `.web.loj` source
- `backend/` — local `.api.loj` source for Spring and FastAPI variants
- `rules/` — shared linked `.rules.loj` files consumed from both frontend and backend through the project shell
- `workflows/` — shared linked `.flow.loj` files consumed from both frontend and backend through the project shell
- `loj.project.yaml` — Spring-backed project shell
- `loj.fastapi.project.yaml` — FastAPI-backed project shell
- `loj.postgres.project.yaml` — Spring-backed project shell with generated PostgreSQL/Flyway/docker-compose profile artifacts plus optional `loj dev` auto-provision, graceful shutdown defaults, runtime health/readiness/drain endpoints, and narrow runtime CORS/forwarded-header/trusted-proxy settings
- `loj.fastapi.postgres.project.yaml` — FastAPI-backed project shell with generated PostgreSQL/native-SQL/docker-compose profile artifacts plus optional `loj dev` auto-provision, graceful shutdown defaults, runtime health/readiness/drain endpoints, and narrow runtime CORS/forwarded-header/trusted-proxy settings

This example proves a closer ATRS-core combination without pretending the repo already has:

- custom-route wizard authoring beyond linked resource workflow
- async reporting/export infrastructure
- travel-specific pricing/runtime packs

## Commands

```bash
# Validate the Spring-backed variant
npm run validate --workspace=@loj/example-fullstack-flight-booking-proof

# Build generated frontend + Spring backend output
npm run build:generated --workspace=@loj/example-fullstack-flight-booking-proof

# Validate and build the Spring + PostgreSQL profile variant
npm run validate:postgres --workspace=@loj/example-fullstack-flight-booking-proof
npm run build:generated:postgres --workspace=@loj/example-fullstack-flight-booking-proof

# Watch and run the Spring-backed variant locally
npm run dev --workspace=@loj/example-fullstack-flight-booking-proof

# Run the browser-level Spring-backed booking flow smoke against `loj dev`
npm run e2e --workspace=@loj/example-fullstack-flight-booking-proof

# Record the same Spring-backed flow into .artifacts/local-e2e/
npm run record:e2e --workspace=@loj/example-fullstack-flight-booking-proof

# Validate the FastAPI-backed variant
npm run validate:fastapi --workspace=@loj/example-fullstack-flight-booking-proof

# Build generated frontend + FastAPI backend output
npm run build:generated:fastapi --workspace=@loj/example-fullstack-flight-booking-proof

# Validate and build the FastAPI + PostgreSQL profile variant
npm run validate:fastapi:postgres --workspace=@loj/example-fullstack-flight-booking-proof
npm run build:generated:fastapi:postgres --workspace=@loj/example-fullstack-flight-booking-proof

# Watch and run the FastAPI-backed variant locally
npm run dev:fastapi --workspace=@loj/example-fullstack-flight-booking-proof

# Run the browser-level FastAPI-backed booking flow smoke against `loj dev`
npm run e2e:fastapi --workspace=@loj/example-fullstack-flight-booking-proof

# Run the narrow combined proof path on both current backends
npm run proof --workspace=@loj/example-fullstack-flight-booking-proof

# Measure the current ATRS-core escape budget explicitly
npm run measure:escape --workspace=@loj/example-fullstack-flight-booking-proof
```

Recommended order:

1. `npm run validate --workspace=@loj/example-fullstack-flight-booking-proof`
2. `npm run build:generated --workspace=@loj/example-fullstack-flight-booking-proof`
3. `npm run validate:fastapi --workspace=@loj/example-fullstack-flight-booking-proof`
4. `npm run build:generated:fastapi --workspace=@loj/example-fullstack-flight-booking-proof`
5. `npm run measure:escape --workspace=@loj/example-fullstack-flight-booking-proof`

Before the first `npm run dev`, make sure the shared React host has its local dependencies installed:

```bash
npm run ci:install-rdsl-host-deps
```

Before the first `npm run e2e`, install the local browser dependency and Chromium for this example:

```bash
npm install --prefix examples/fullstack-flight-booking-proof
npx --prefix examples/fullstack-flight-booking-proof playwright install chromium
```

Current local dev defaults come from `.env`:

- frontend host bind: `0.0.0.0`
- frontend host: `http://127.0.0.1:5176`
- frontend preview: `http://127.0.0.1:4176`
- backend server bind: `0.0.0.0`
- backend server: `http://127.0.0.1:3004`
- local proxy auth: `admin / admin123`

That `0.0.0.0` bind is intentional so a Windows browser can reach the dev host and backend when
`loj dev` is running inside WSL.

Generated output stays local and is not committed:

- `generated/frontend/`
- `generated/backend/`
- `generated/backend-fastapi/`
- `generated/backend-postgres/`
- `generated/backend-fastapi-postgres/`

Escape-budget artifacts also stay local:

- `.artifacts/escape-budget/summary.json`
- `.artifacts/escape-budget/summary.md`

Browser E2E and recording artifacts also stay local:

- `.artifacts/local-e2e/`
- `.artifacts/local-e2e-fastapi/`

## What This Proof Covers

The generated app currently includes:

- an availability page backed by two named read-models, `readModel outwardFlightAvailability` and `readModel homewardFlightAvailability`
- shared-query outbound/homeward dual-table consumption with generated date-navigation over the current outward/homeward date inputs
- richer flight-availability row shape with airport-name, route/time, fare-brand, availability-band, baggage, change-policy, ticketing-advisory, vacancy-message, and fare-rules presentation fields plus a grouped read-model matrix consumer over multi-offer rows for the same flight/timing
- richer flight-availability messaging density with boarding and refund-policy summaries carried from the grouped matrix into the booking flow
- generated search-to-book handoff from search results into the booking create start, including a page-level selected-itinerary create action over shared outbound/homeward table selection plus URL-backed search query preservation on return
- matching `flight-availability.rules.loj` definitions consumed on both frontend and backend
- a workflow-linked `bookings` resource with richer representative/contact fields, selected-flight airport/availability/seat plus baggage/policy/ticketing/vacancy summary fields, explicit confirmation/failure guidance plus failure-reason/recovery/history-review fields, and repeated passenger child forms
- matching `booking-lifecycle.flow.loj` definitions linked on both frontend and backend
- `booking-lifecycle.flow.loj` also uses narrow `wizard.steps[].surface` mapping plus generated `workflowStep` handoff so create/read/workflow surfaces cover confirm/review and redo/back without custom routing glue, while an explicit `FAILED` workflow branch plus `reopen` transition now exercise a thicker ticketing-failure path with seeded recovery guidance but still without custom route wiring
- backend nested create/update for bookings plus passengers
- frontend/backend booking rules over top-level fields now also stress passenger-count, selected-flight capacity, limited-band, limited-seat-buffer, and agent-ticketing checks, derive `serviceFee` / `taxAmount` / `vacancySurcharge`, and repeated passenger rules now include item-aware child/member contact plus seat-preference cross-checks
- a `members` resource with richer identity/contact plus recovery-desk/disruption/history-note fields and booking-history read surfaces through `read.related` and a record-scoped page
- narrow web-family metadata and style proof via `app.seo`, `page.seo`, `@asset(...)`, linked `app.style`, differentiated page/block shell styles on the availability/history pages, resource-specific `list/read/create/edit/workflow` shell styles across bookings, members, and passengers, plus a proof-local raw CSS escape mounted through a hidden custom host component for finer sidebar/table/form/workflow polish

This makes it a stronger semantic-combination proof than the older CRUD-only examples, but it is
still not a claim about every possible ATRS interpretation by itself.

## Browser Flow Smoke And Recording

The local E2E flow currently covers the narrow happy path:

- load `/availability`
- search `HND -> CTS`
- select one outbound and one homeward offer
- open `Create Bookings`
- fill the minimum representative/passenger fields
- submit the booking
- assert that the generated read page loads
- assert that the created booking and passenger exist through backend APIs

`npm run record:e2e` reuses the same browser flow, saves a Playwright `.webm`, and also emits
an `.mp4` when `ffmpeg` is available on the machine.

## Database Runtime Variants

The default proof paths still use the existing embedded local-database defaults:

- Spring Boot -> generated H2 configuration
- FastAPI -> generated SQLite configuration

The PostgreSQL project-shell variants above now demonstrate the first narrow database-runtime slice
through `loj.project.yaml` orchestration. Those builds generate:

- backend runtime-specific dependency/config rewrites
- `.env.database.example`
- `docker-compose.database.yaml`
- native `db/schema.sql`
- native baseline SQL when `migrations: native-sql`
- Spring Flyway-native `V1__baseline.sql` when `migrations: flyway`
- narrow `runtime.shutdown` rewrite for Spring Boot properties or FastAPI lifespan/run defaults
- narrow `runtime.health/readiness/drain` endpoint generation for Spring Boot and FastAPI

`database.autoProvision: true` now also lets `loj dev` bring the generated docker-compose database
up and down for supported vendors (`postgres`, `mysql`, `mariadb`) without adding any database
syntax to `.api.loj`.

The current runtime-profile matrix is broader than the docker-compose matrix:

- Spring Boot: `h2`, `postgres`, `mysql`, `mariadb`, `sqlserver`, `oracle`
- FastAPI: `sqlite`, `postgres`, `mysql`, `mariadb`, `sqlserver`, `oracle`

This keeps database/runtime selection in project/profile/env orchestration rather than adding
database-vendor keywords to `.api.loj`.

Current measured reading:

- Spring-backed proof pair: `1%` combined escape usage after integer rounding (`4 / 484` semantic escape nodes)
- FastAPI-backed proof pair: `1%` combined escape usage after integer rounding (`4 / 484` semantic escape nodes)
- Shared Loj authoring volume: `1145` non-empty lines
- Shared generated React volume: `6252` non-empty lines
- Spring-backed escape-hatch breakdown: `20` mock-data lines, `12` target-local business-logic lines, `8` target-local support/wiring lines
- FastAPI-backed escape-hatch breakdown: `388` mock-data lines, `16` target-local business-logic lines, `8` target-local support/wiring lines
- Spring-backed code volume: `1185` handwritten non-empty lines vs `13062` generated non-empty lines
- FastAPI-backed code volume: `1557` handwritten non-empty lines vs `11205` generated non-empty lines

Those numbers come from `npm run measure:escape` and are written to
`.artifacts/escape-budget/summary.json` plus `.artifacts/escape-budget/summary.md`.
