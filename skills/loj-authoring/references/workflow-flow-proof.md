# Workflow / Flow (`.flow.loj`)

Use this reference for the current first-slice workflow/state-machine surface.

It still has standalone CLI entry points, but it is no longer standalone-only:

- `.api.loj` may link it through `resource workflow: '@flow("./workflows/x")'`
- `.web.loj` may link it through either:
  - `resource workflow: '@flow("./workflows/x")'`
  - `resource workflow: { source: '@flow("./workflows/x")', style: workflowShell }`
- `loj.project.yaml` still does not orchestrate `.flow.loj` directly

## Current Scope

Implemented today:

- `.flow.loj` file suffix
- one named workflow per file
- parser + validator + shared workflow-manifest generation
- repo CLI entry:
  - `loj flow validate <file.flow.loj>`
  - `loj flow build <file.flow.loj> --out-dir <dir>`
- narrow `.api.loj` linkage through `resource workflow: '@flow("./workflows/x")'`
- narrow `.web.loj` linkage through scalar or mapping `resource workflow`
- generated backend transition-enforcement surface for Spring Boot + FastAPI
- generated frontend create/edit/read workflow summaries, step-aware create/edit submit CTA labels, and next-step-prioritized read-surface transition actions
- fixed generated frontend workflow route/page at `/:id/workflow` for workflow-linked resources

Not implemented yet:

- project-shell orchestration for flow targets
- broader custom page-level wizard routing or long-transaction semantics beyond the fixed generated workflow page
- non-resource workflow consumers

## File Shape

Use one top-level block:

```yaml
workflow booking-process:
  model: Booking
  field: status

  states:
    DRAFT:
      label: "Draft"
      color: gray
    READY:
      label: "Ready"
      color: blue
    CONFIRMED:
      label: "Confirmed"
      color: green

  wizard:
    steps:
      - name: select-flight
        completesWith: DRAFT
        surface: form
      - name: enter-passengers
        completesWith: READY
        surface: read
        allow: currentUser.role in [ADMIN, AGENT]

  transitions:
    confirm:
      from: READY
      to: CONFIRMED
      allow: currentUser.role == ADMIN
```

Rules:

- exactly one top-level `workflow <name>:` block per file
- `model` is required
- `field` is required
- `states` is required
- `transitions` is required
- `wizard` is optional

Richer booking-style example:

```yaml
workflow booking-process:
  model: Booking
  field: status

  states:
    DRAFT:
      label: "Draft"
      color: gray
    READY:
      label: "Ready"
      color: blue
    CONFIRMED:
      label: "Confirmed"
      color: green
    FAILED:
      label: "Failed"
      color: red

  wizard:
    steps:
      - name: select-itinerary
        completesWith: DRAFT
        surface: form
      - name: review-booking
        completesWith: READY
        surface: read
      - name: complete-ticketing
        completesWith: CONFIRMED
        surface: workflow

  transitions:
    confirm:
      from: READY
      to: CONFIRMED
      allow: currentUser.role in [ADMIN, AGENT]
    fail_ticketing:
      from: READY
      to: FAILED
      allow: currentUser.role in [ADMIN, AGENT]
    reopen:
      from: FAILED
      to: READY
      allow: currentUser.role == ADMIN
```

Use this kind of thicker example when the task is booking/approval/recovery oriented. It is still
within the current first-slice workflow surface.

## Supported Keys

Top-level workflow keys:

- `model`
- `field`
- `states`
- `wizard`
- `transitions`

Inside each `states:` entry:

- optional `label`
- optional `color`

Inside each `wizard.steps:` item:

- required `name`
- required `completesWith`
- optional `surface`
- optional `allow`

Current `surface` values:

- `form`
- `read`
- `workflow`

Current defaulting:

- first wizard step defaults to `form`
- later wizard steps default to `workflow`

Inside each `transitions:` entry:

- required `from`
- required `to`
- optional `allow`

## Expression Language

The current flow proof reuses the same constrained expression language used by `.web.loj`,
`.api.loj`, and `.rules.loj`.

Use:

- comparisons like `==`, `!=`, `>`, `<`, `>=`, `<=`
- logical `&&`, `||`, `not`
- arithmetic like `+`, `-`, `*`, `/`
- dotted paths like `currentUser.role`, `record.status`
- membership like `currentUser.role in [ADMIN, AGENT]`

Do not use:

- raw JavaScript, Java, or Python
- statements, loops, imports, closures
- router/state-machine/transaction-framework internals

## Current Command Path

Validate:

```bash
loj flow validate ./workflows/booking-process.flow.loj
```

Build manifest:

```bash
loj flow build ./workflows/booking-process.flow.loj --out-dir ./generated/flow
```

Current build output is a standalone workflow manifest JSON file. Treat it as the first proof
surface, even though that same manifest is now also consumed by narrow `.api.loj` / `.web.loj`
resource linkage.

## Current Linked Resource Surfaces

Backend:

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-process")'
```

- Spring Boot + FastAPI generate workflow-aware create/update wrappers
- create seeds the initial workflow state from the first wizard step's `completesWith` when present, otherwise the first declared workflow state
- update preserves the current workflow state rather than accepting direct state mutation through the normal update payload
- workflow-linked resources also gain `POST /.../{id}/transitions/{transition}` for transition enforcement

Frontend:

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  workflow:
    source: '@flow("./workflows/booking-process")'
    style: workflowShell
  read:
    fields: [reference, status]
```

- generated create/edit/read surfaces reuse the linked workflow manifest
- on `.web.loj`, `workflow:` may be a scalar `@flow("./workflows/x")` or a mapping with
  `source:` plus optional shell-level `style:`
- `wizard.steps[].surface` now controls narrow generated handoff across existing surfaces: `form` reuses generated edit after record creation, `read` reuses the generated read surface, and `workflow` reuses the fixed generated workflow page
- create shows workflow state plus visible wizard steps, derives narrow current/next-step summaries, upgrades the primary submit CTA to `Create and continue to <next step>` when a visible next step exists, and defaults successful submit into the next step's declared surface when no explicit redirect or app-local `returnTo` exists
- edit shows workflow state plus visible wizard steps, derives the same narrow current/next-step summaries, upgrades the primary submit CTA to `Save and continue to <next step>` when a visible next step exists, surfaces a narrow `Workflow` link into the fixed workflow page, and defaults successful submit into that same next-step surface resolution when no explicit redirect or app-local `returnTo` exists
- read also shows next-step-prioritized allowed transitions, narrow current/next-step summaries, a generated `workflowStep` handoff when later-step review is requested, and a narrow `Redo <previous step>` link when a previous visible step exists; it posts to the generated backend transition route, and successful transitions now also hand off into the next visible wizard step's declared surface when that surface changes
- generated routing also adds a fixed `/:id/workflow` page that reuses the same manifest for current-state summary, narrow current/next-step summaries, wizard-step progress, next-step-prioritized transition actions, narrow `workflowStep` review handoff, `Redo <previous step>` navigation, post-transition next-step handoff, a narrow related-surface summary derived from existing `read.related` anchors when a read view exists, generated `read.fields` record-context details plus generated `read.related` panel context when a read view exists, preserves workflow links and workflow state labels across label-list related fallbacks when the target resource has no generated read/edit surface, and narrow `View` / `Edit` / `Back` links with sanitized app-local `returnTo`
- record-scoped relation pages that already exist for the same parent resource also pass a narrow `parentWorkflow` summary into adjacent generated custom blocks when that parent resource is workflow-linked
- the workflow-controlled enum state field may not be listed as a plain generated `create.fields` or `edit.fields` entry

Current expression boundary for linked workflow usage:

- wizard step `allow` stays inside the shared expression language
- web wizard-step visibility currently supports `currentUser`, `record`, `formData`, and bare enum-like literals
- backend transition enforcement currently supports `currentUser`, `record`, and bare enum-like literals

## Hard Guardrails

- Do not invent any `.flow.loj` linkage beyond:
  - `resource workflow: '@flow("./workflows/x")'` in `.api.loj`
  - `resource workflow: '@flow("./workflows/x")'` in `.web.loj`
  - `resource workflow: { source: '@flow("./workflows/x")', style: workflowShell }` in `.web.loj`
- Do not add policy/rules syntax to `.flow.loj`.
- Do not add target-specific router or transaction vocabulary to `.flow.loj`.
- Do not invent `loj.project.yaml` workflow target types yet.
- Keep workflow authoring declarative and target-neutral.
