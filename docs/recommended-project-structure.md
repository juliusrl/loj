# Recommended Project Structure

## Status

This is a recommendation, not a hard parser/compiler requirement.

Use it as the default layout for:

- new `loj.project.yaml` apps
- AI-authored projects
- future scaffold/init defaults

Do not treat it as the only legal repo shape.

---

## Purpose

The repo now has enough surface area that a default directory shape is useful:

- it lowers AI authoring drift
- it gives linked `@rules(...)`, `@flow(...)`, `@sql(...)`, `@style(...)`, and `@asset(...)` files a predictable home
- it keeps `.web.loj`, `.api.loj`, `.rules.loj`, `.flow.loj`, `.style.loj`, and host escape files separated by concern

This document fixes the recommended layout, not a mandatory one.

---

## Recommended Default

```text
my-app/
  loj.project.yaml

  frontend/
    app.web.loj
    models/
    resources/
    read-models/
    pages/
    rules/
    workflows/
    styles/
    components/
    logic/
    assets/

  backend/
    app.api.loj
    models/
    resources/
    read-models/
    rules/
    workflows/
    handlers/
    policies/
    queries/
```

Intent:

- `frontend/` keeps web-family source, style, SEO asset refs, and frontend escape files together
- `backend/` keeps api-family source, read-model handlers/queries, and backend policy/rule/workflow files together
- `loj.project.yaml` stays at the app root

---

## Frontend Layout

Recommended:

```text
frontend/
  app.web.loj
  models/
    booking.web.loj
    member.web.loj
  resources/
    bookings.web.loj
    members.web.loj
  read-models/
    outward-flight-availability.web.loj
    homeward-flight-availability.web.loj
  pages/
    availability.web.loj
    member-history.web.loj
  rules/
    booking-create.rules.loj
    booking-edit.rules.loj
    passenger-create.rules.loj
  workflows/
    booking-lifecycle.flow.loj
  styles/
    theme.style.loj
  components/
    ProofCssMount.tsx
    proof-overrides.css
  logic/
    canEditBooking.ts
  assets/
    og-default.png
```

Use these folders by role:

- `models/` -> `model <Name>:`
- `resources/` -> `resource <name>:`
- `read-models/` -> `readModel <name>:`
- `pages/` -> `page <name>:`
- `rules/` -> linked `.rules.loj`
- `workflows/` -> linked `.flow.loj`
- `styles/` -> linked `.style.loj`
- `components/` -> frontend host escape files like `@custom(...)`
- `logic/` -> frontend `@fn(...)` host helpers
- `assets/` -> `@asset(...)` image/favicon/OG assets

---

## Backend Layout

Recommended:

```text
backend/
  app.api.loj
  models/
    booking.api.loj
    member.api.loj
  resources/
    bookings.api.loj
    members.api.loj
  read-models/
    outward-flight-availability.api.loj
    homeward-flight-availability.api.loj
  rules/
    booking-create.rules.loj
    booking-create-api.rules.loj
    flight-availability.rules.loj
  workflows/
    booking-lifecycle.flow.loj
  handlers/
    flightAvailability.java
    flightAvailability.py
  policies/
    booking-access.java
    booking-access.py
  queries/
    flightAvailability.sql
```

Use these folders by role:

- `models/` -> `model <Name>:`
- `resources/` -> `resource <name>:`
- `read-models/` -> `readModel <name>:`
- `rules/` -> linked `.rules.loj`
- `workflows/` -> linked `.flow.loj`
- `handlers/` -> backend `@fn(...)` read-model handlers
- `policies/` -> backend `auth.policy: '@fn(...)'`
- `queries/` -> backend read-model `@sql(...)`

---

## `loj.project.yaml`

Recommended root placement:

```text
my-app/
  loj.project.yaml
```

Recommended target entries:

```yaml
app:
  name: my-app

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
  backend:
    type: api
    entry: backend/app.api.loj
```

Keep database/runtime/dev orchestration in this file, not in `.web.loj` / `.api.loj`.

---

## Command Recommendation

For normal authoring and generated-output work, prefer project-shell commands:

```bash
loj validate loj.project.yaml
loj build loj.project.yaml
loj dev loj.project.yaml
loj doctor loj.project.yaml
```

Use `--target <alias>` when you still want project-shell database/runtime profiles but only need
one side:

```bash
loj build loj.project.yaml --target backend
loj dev loj.project.yaml --target frontend
```

`rdsl` / `sdsl` remain useful, but they are now secondary tools for:

- pure single-family work
- compiler/debug work
- local low-level validation outside project-shell orchestration

They should no longer be the default entrypoint shown to new users.

---

## Guardrails

- This layout is recommended, not enforced.
- Do not hardcode folder names into compiler semantics.
- Future scaffold/init commands should default to this structure, but authoring should still allow
  alternate paths through `entry` and relative linked-file references.
