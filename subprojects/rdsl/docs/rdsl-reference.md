# The Lojban Paradigm (Frontend-Family `.web.loj`) — LLM Reference Documentation

> **Purpose**: This document is the single source of truth for generating valid frontend-family `.web.loj` files.
> Give this to any LLM and it should be able to produce correct logic and UI structure on the first attempt, following the Lojban paradigm of unambiguous instructions.
>
> If you are using repo-local AI skills, use [skills/loj-authoring/SKILL.md](../../../skills/loj-authoring/SKILL.md) as the unified workflow wrapper.
> This file remains the canonical syntax and contract reference.
>
> Legacy note: `.rdsl` remains a supported frontend-family alias for the current beta cycle.
>
> Shared shape note: when frontend-family syntax or generated surfaces reuse a stable descriptor shape that also appears elsewhere in the repo, the canonical shared form now lives in [shared-compiler-contracts.md](../../../docs/shared-compiler-contracts.md). Current frontend-family usage includes shared message descriptors, handoff/seed descriptors, read-model page-consumer bindings, workflow meta/summary/map aliases, relation summaries, and record-scoped custom-block context. `.web.loj` authoring does not import that package directly; this note only fixes the compiler/runtime contract boundary.

## Schema Version: 0.1.0

---

## File Structure

A frontend-family source file (`.web.loj`, legacy `.rdsl`) is a **strict YAML subset** (no anchors, aliases, merge keys, or custom tags).

ReactDSL supports two project shapes:

- **Single-file app**: one root `.web.loj` file with `app:`, optional `compiler:`, and semantic definitions
- **Root-plus-modules app**: one root `.web.loj` file with optional `imports:` plus semantic module files, where imported modules may also import other modules

A single-file app is just a root file with no `imports:`.

Top-level keys in a **root file**:

| Key | Required | Description |
|-----|----------|-------------|
| `app:` | Yes | Application config: name, theme, auth, navigation |
| `compiler:` | No | Code generation config: currently only `target: react` |
| `imports:` | No | Root-only list of additional frontend-family module files |
| `model <Name>:` | Yes (1+) | Data model definition with fields and decorators |
| `resource <name>:` | Yes (1+) | CRUD resource bound to a model and API endpoint |
| `page <name>:` | No | Dashboard or custom page with layout blocks |

Top-level keys in a **module file**:

| Key | Allowed | Description |
|-----|---------|-------------|
| `model <Name>:` | Yes | Data model definition |
| `resource <name>:` | Yes | CRUD resource definition |
| `page <name>:` | Yes | Dashboard/custom page definition |
| `imports:` | Yes | Optional transitive module links |
| `app:` | No | Root-only |
| `compiler:` | No | Root-only |

Current multi-file support is intentionally narrow:

- imports must be relative `.web.loj` / `.rdsl` file paths or relative directories ending with `/`
- nested imports are allowed
- import cycles are invalid and reported with an import chain
- imported definitions merge into one app-wide namespace
- there is still one canonical entry file with the only `app:` and `compiler:` blocks
- directory imports expand only direct child frontend-family source files, sorted lexicographically

Duplicate model/resource/page names across files are errors.

Recommended default:

- small demos and prompt-sized apps: single file
- larger admin/workflow apps: split by domain with `imports:`

---

## `app:` Block

```yaml
app:
  name: "My Admin"          # App title (string, required)
  theme: dark                # "dark" | "light" (default: "light")
  auth: jwt                  # "jwt" | "session" | "none" (default: "none")
  navigation:                # Sidebar navigation groups
    - group: "Section Name"
      visibleIf: <expr>      # Optional: visibility rule
      items:
        - label: "Page Title"
          icon: dashboard     # Icon name
          target: page.dashboard       # page.<name> or resource.<name>.list
```

---

## `compiler:` Block

Use this block only for code generation settings. Do not put business logic, runtime auth, or API information here.

```yaml
compiler:
  target: react   # Optional. Default: react. v0.1 only supports "react".
```

The `compiler:` block exists so the DSL can grow to multiple targets later without overloading `app:`. In schema `0.1.0`, any value other than `react` is invalid.
Future schema versions may separate target family, implementation language, and profile, but those extra keys are not part of `0.1.0` yet.
UI framework integrations such as Ant Design should eventually land as additive profiles/runtime packages on top of `target: react`, not as separate DSL dialects.

---

## `imports:` Block

Use `imports:` for explicit module links. The root file is still the only file that may contain `app:` and `compiler:`.

```yaml
imports:
  - ./models/user.web.loj
  - ./resources/users.web.loj
  - ./pages/dashboard.web.loj
```

Rules:

- each entry must be either a relative `.web.loj` / `.rdsl` file path or a relative directory path ending with `/`
- import order does not change semantic meaning
- imported files share the same global namespace as the root file
- module files may contain their own `imports:`
- import cycles are invalid
- directory imports expand only direct child frontend-family source files, in lexicographic path order
- directory imports are not recursive
- the root file may still keep local `model`, `resource`, and `page` definitions
- escape hatch paths inside a module file resolve relative to that module file, not the root file

Recommended split heuristic:

- `1-3` models and `1-2` resources: keep one file
- `4+` models or `3+` resources: split by domain
- custom pages with multiple blocks: give the page its own file

---

## `model <Name>:` Block

Defines data shape. Each field has a type and optional decorators.

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  status: enum(active, suspended)
  createdAt: datetime @auto
```

Resource-backed records include an implicit runtime field:

```yaml
id: string   # Generated automatically for routing, editing, and row actions
```

Do not list `id` in `fields:` unless you explicitly want to expose it in a view.

### Field Types

| Type | TypeScript | Description |
|------|------------|-------------|
| `string` | `string` | Text field |
| `number` | `number` | Numeric field |
| `boolean` | `boolean` | True/false |
| `datetime` | `string` (ISO) | Date/time |
| `enum(a, b, c)` | `'a' \| 'b' \| 'c'` | Enumerated values |
| `belongsTo(Model)` | `string \| number \| null` | Foreign-key-style relation to another model |
| `hasMany(Model, by: field)` | metadata only | Derived inverse relation metadata; not emitted into generated client model types yet |

### Field Decorators

| Decorator | Description |
|-----------|-------------|
| `@required` | Field must not be empty |
| `@email` | Must be valid email format |
| `@unique` | Value must be unique |
| `@minLen(n)` | Minimum string length |
| `@auto` | Auto-generated (e.g. timestamps) |

Relation rules:

- `belongsTo(Model)` requires that `Model` exists
- `hasMany(Model, by: field)` requires that `Model` exists and `by:` points to a `belongsTo(CurrentModel)` field on the target model
- the current frontend-family slice treats a `belongsTo(...)` field as a related record id in generated forms
- generated `create` / `edit` views render `belongsTo(...)` fields as select inputs when the related resource exists
- generated `create` views also seed matching `belongsTo(...)` fields from same-named query params and use sanitized app-local `returnTo` as the Cancel target when present
- if a generated `create` view does not declare an explicit `redirect` effect, that same sanitized `returnTo` becomes the default post-create redirect
- generated `edit` views use sanitized app-local `returnTo` as the Cancel target when present
- if a generated `edit` view does not declare an explicit `redirect` effect, that same sanitized `returnTo` becomes the default post-edit redirect
- generated `read` views use sanitized app-local `returnTo` for Back when present and preserve it when linking to edit
- generated web list columns, list filters, and sortable list columns can use narrow relation-derived projections such as `team.name` and `members.count` when the related resource exists
- generated `read:` views can use the same narrow relation-derived projections in `fields:`
- generated `read.related:` accepts direct `hasMany(..., by: ...)` field names such as `members`
- when the related resource has a `list:` view, generated `read.related:` panels reuse its `columns`, filters, sortable relation columns, pagination, and narrow `view` / `edit` / `create` / `delete` actions; otherwise they fall back to a simple label-list that links to generated `read`, then generated `edit`, and finally the fixed workflow page when the target resource is workflow-linked, while also showing the target workflow state label when that workflow metadata exists
- those reused relation `view` / `edit` / `create` actions pass sanitized app-local `returnTo` back to the originating relation surface
- reused relation `create` actions also seed the inverse `belongsTo(...)` field into the target create view
- generated record-scoped relation pages can use `page.path: /<resource>/:id/...` plus `data: <resource>.<hasManyField>` in `page` table blocks to reuse the related resource's `list:` surface when it exists and otherwise fall back to a simple related-record label-list
- page `table` blocks that reuse a `create` action pass sanitized app-local `returnTo`; record-scoped relation page table blocks also seed the inverse `belongsTo(...)` field
- generated record-scoped relation pages can also use `data: <resource>.<hasManyField>.count` in `metric` blocks to render a narrow related-record count without opening query syntax
- generated record-scoped relation pages themselves use sanitized app-local `returnTo` for Back when present and otherwise fall back to the parent resource read route or list route
- generated record-scoped relation pages also surface narrow parent `view` / `edit` header actions when those parent routes exist; those links carry sanitized app-local `returnTo`
- `hasMany(...)` is inverse metadata only; it is not emitted as a generated client model field and cannot be used directly in generated list/filter/create/edit/read.fields surfaces
- `hasMany(...)` inverse fields do not support field decorators

---

## `resource <name>:` Block

Binds a model to an API and defines CRUD views.

```yaml
resource users:
  model: User                # Reference to a model name
  api: /api/users            # API endpoint (string, required)

  list:                      # List/table view
    title: "User Management"
    style: listShell
    filters: [email, role, team.name]   # Fields that can be filtered
    columns:                 # Table columns
      - name @sortable
      - email @sortable
      - team.name @sortable
      - members.count @sortable
      - role @tag(admin:red, editor:blue, viewer:gray)
      - status @badge(active:green, suspended:red)
      - createdAt @date
    actions:                 # Available actions
      - create
      - view
      - edit
      - delete @confirm("Are you sure?")
    pagination: { size: 20, style: numbered }

  read:                      # Generated read/detail surface
    title: "User Details"
    style: detailShell
    fields:
      - name
      - team.name

  edit:                      # Edit form view
    style: formShell
    fields:
      - name
      - email @disabled
      - role @select
    rules:
      visibleIf: <expr>      # Show/hide the form
      enabledIf: <expr>      # Enable/disable the form
      allowIf: <expr>        # Guard form submission
      enforce: <expr>        # Must also be checked server-side
    onSuccess:
      - refresh: users
      - toast: "Saved!"

  create:                    # Create form view
    style: formShell
    fields:
      - name
      - email
      - field: role @select
        rules:
          enabledIf: currentUser.role == "admin"
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - ageGroup
          - field: seat
            rules:
              enabledIf: item.ageGroup != "infant"
        rules: '@rules("./rules/passenger-row")'
    onSuccess:
      - redirect: users.list
      - toast: "Created!"
```

Current linked `.rules.loj` form rules:

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - baseFare
      - travelerCount
      - quotedFare
    rules: '@rules("./rules/booking-create")'
  edit:
    fields:
      - status
      - baseFare
      - travelerCount
      - quotedFare
    rules: '@rules("./rules/booking-edit")'
```

Current `workflow:` rules:

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: workflowShell
```

- `workflow:` is optional and may be either a scalar `@flow("./workflows/x")` link or a mapping with `source:` plus optional `style:`
- extensionless logical ids are preferred for `workflow:`
- the linked workflow `model` must match the resource `model`
- the linked workflow `field` must point to an `enum(...)` field on that model
- the linked workflow must declare every enum value from that field, and every declared workflow state must exist in that enum
- the workflow-controlled enum field may not appear as a plain generated `create.fields` or `edit.fields` entry unless you intentionally use a custom field escape

Current style attachment rules:

- `list.style`, `read.style`, `create.style`, and `edit.style` are optional and must reference named styles from the linked `app.style` program
- `workflow.style` follows the same rule when `workflow:` uses the mapping form
- these first-wave style hooks attach only to the generated root shell of the corresponding surface; they do not yet provide separate `table`, `form section`, or `read.related` styling hooks

Current `create.includes` / `edit.includes` rules:

- `includes:` is optional on both generated `create:` and generated `edit:`
- each entry must reference a direct `hasMany(Target, by: field)` relation on the resource model
- each entry may optionally set `minItems: <non-negative integer>` to seed repeated child rows in the generated form
- child `fields:` must belong to the related target model
- the inverse `by:` field is seeded automatically and must not be listed again
- child `fields:` may currently use scalar, enum, or `belongsTo(...)` fields on the child model
- child `fields:` may not use `hasMany(...)`
- `edit.fields`, `create.fields`, `create.includes[].fields`, and `edit.includes[].fields` may use object entries with `field:` plus narrow field-level `rules.visibleIf` / `rules.enabledIf`
- field-level rules reuse the same shared expression language:
  - create/edit root fields may reference `currentUser`, `formData`, and `record` in edit only
  - repeated child fields may reference `currentUser`, `formData`, and `item`, plus `record` in edit
- the current slice renders repeated child sections in generated create/edit forms, with generated add/remove controls and `minItems` floor enforcement
- `create.includes[].rules` and `edit.includes[].rules` may also use `rules: '@rules("./rules/x")'`
- generated `edit.includes` now loads existing child rows through the related target resource and submits a one-level diff payload:
  - child rows with `id` update
  - child rows without `id` create
  - omitted existing child rows delete
- the current slice still does not support deeper child nesting or arbitrary nested mutation syntax

Current linked form-rule behavior:

- `edit.rules` and `create.rules` may still use the inline mapping with `visibleIf` / `enabledIf` / `allowIf` / `enforce`
- they may also use `rules: '@rules("./rules/x")'`
- current frontend linked form-rule consumption supports only:
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- linked `allow/deny` entries are rejected on generated create/edit surfaces
- linked `eligibility` gates the generated surface locally and shows a generated error surface instead of rendering the form
- linked `validate` runs locally before submit and shows a generated validation message
- linked `derive` currently supports only top-level scalar generated form fields already listed in `create.fields` / `edit.fields`
- linked derive targets are rendered as generated read-only fields in the current slice
- linked create rules may reference `currentUser` and `formData`
- linked edit rules may reference `currentUser`, `formData`, and `record`
- linked repeated-child include rules may reference:
  - `currentUser`, `formData`, `item` in `create.includes[].rules`
  - `currentUser`, `formData`, `item`, `record` in `edit.includes[].rules`
- linked repeated-child include rules support only:
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- linked repeated-child `derive` currently supports only scalar generated child fields already listed in that include's `fields:`
- linked form consumers still do not open imperative event-handler syntax

### Column Decorators

| Decorator | Description |
|-----------|-------------|
| `@sortable` | Column can be sorted |
| `@date` | Format as date |
| `@tag(key:color, ...)` | Render as colored tag |
| `@badge(key:color, ...)` | Render as status badge |
| `@custom("./path.tsx")` | **Escape hatch tier 1**: custom cell renderer |

### Field Decorators (in edit/create)

| Decorator | Description |
|-----------|-------------|
| `@select` | Render as dropdown select |
| `@disabled` | Field is read-only |
| `@custom("./path.tsx")` | **Escape hatch tier 2**: custom field component |

`read.fields:` reuses the display decorators from list columns except `@sortable`.

### Actions

| Action | Description |
|--------|-------------|
| `create` | Show "Create" button |
| `view` | Show "View" action per row when the resource has a `read:` view |
| `edit` | Show "Edit" action per row |
| `delete` | Show "Delete" action per row |
| `delete @confirm("msg")` | Delete with confirmation dialog |

Related panel example:

```yaml
resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
      - members.count
    related:
      - members
```

If the related resource also defines `list:`, the generated panel reuses that target list's columns, filters, sortable relation columns, pagination, and narrow `view` / `edit` / `create` / `delete` actions.
When that reused action surface includes `view`, `edit`, or `create`, the generated link adds sanitized app-local `returnTo` so the target read/edit/create surface can return to the panel or related page. Reused relation `create` also seeds the inverse `belongsTo(...)` field into the target create view. If the generated create/edit view has no explicit `redirect` effect, that same `returnTo` becomes the default post-submit redirect.
The generated app also adds a record-scoped related collection route at `/:id/related/<field>` for each `read.related` entry.

Workflow-linked resources also reuse the linked `.flow.loj` manifest in generated create/edit/read surfaces:

- create shows the initial workflow state plus visible wizard steps
- `wizard.steps` may now also set an optional `surface: form | read | workflow`; when omitted, the first step defaults to `form` and later steps default to `workflow`
- create also derives narrow current/next-step summaries from those visible wizard steps, upgrades the primary submit CTA to `Create and continue to <next step>` when a visible next step exists, and, when no explicit redirect effect or app-local `returnTo` is present, defaults successful submit into the next step's declared surface (`form` -> generated edit, `read` -> generated read, `workflow` -> fixed workflow page), with the fixed workflow page as the fallback
- edit shows the current workflow state plus visible wizard steps, derives the same narrow current/next-step summaries, upgrades the primary submit CTA to `Save and continue to <next step>` when a visible next step exists, now also surfaces a narrow `Workflow` link into the fixed workflow page, and when no explicit redirect effect or app-local `returnTo` is present, defaults successful submit into that same next-step surface resolution
- read shows the current workflow state, visible wizard steps, narrow current/next-step summaries, a narrow generated `workflowStep` handoff when a later review step is requested, and a narrow `Redo <previous step>` link when a previous visible step exists; it now prioritizes transitions that advance to the next visible wizard step before rendering other allowed transition actions that post to `/api/.../{id}/transitions/{transition}`; after a successful transition, the generated surface now also redirects into the next visible wizard step's declared surface when that surface changes
- generated list/read/table rendering now also reuses workflow state labels for the workflow-controlled enum field instead of only showing raw enum values
- resource-backed table consumers now also surface a narrow `Workflow` row action that links to the fixed workflow page with sanitized app-local `returnTo`
- generated routing also adds a fixed resource workflow page at `/:id/workflow`, reusing the same linked workflow manifest for current-state summary, narrow current/next-step summaries, wizard-step progress, next-step-prioritized transition actions, narrow `workflowStep` review handoff, `Redo <previous step>` navigation, post-transition next-step surface handoff, a narrow related-surface summary derived from existing `read.related` anchors when a read view exists, generated `read.fields` record-context details plus generated `read.related` panel context when a read view exists, narrow label-list fallback links plus workflow state labels for workflow-linked related targets when they have no generated read/edit surface, and narrow `View` / `Edit` / `Back` links with sanitized app-local `returnTo`

Current workflow constraint:

- workflow linkage is still resource-level only today; the workflow page route is generated from that linkage rather than authored separately, so do not invent custom page-level wizard routing, project-shell workflow targets, or router/state-machine-library vocabulary in `.web.loj`

---

## `readModel <name>:` Block

```yaml
readModel flightAvailability:
  api: /api/flights/search
  rules: '@rules("./rules/flight-availability")'
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
    quotedFare: number
  list:
    groupBy: [flightNo]
    pivotBy: fareBrand
    columns:
      - flightNo
      - fareBrand
      - quotedFare
    pagination:
      size: 10
      style: numbered
```

Current `readModel` rules:

- `readModel <name>:` is a top-level block in `.web.loj`
- `api:` is required and points at a fixed GET endpoint
- `rules:` is optional and must use `@rules("./rules/x")`
- `inputs:` and `result:` must be YAML mappings, not field lists
- `inputs:` and `result:` currently support only scalar and enum field types
- `list:` is required only for `data: readModel.<name>.list`; count-only metric consumers via `data: readModel.<name>.count` do not need it
- the current frontend-family consumers are `page` table blocks via `data: readModel.<name>.list` and `page` metric blocks via `data: readModel.<name>.count`
- those generated page surfaces use query-state `FilterBar` inputs from `inputs:`, URL-backed read-model-scoped query state, and required-input gating before the first fetch; the table consumer also adds local sort/pagination over fetched rows, while the metric consumer stays count-only
- read-model page consumers may also set `queryState: <name>` to share one URL-backed query state across multiple read-model consumers with identical `inputs:`
- when multiple read-model consumers share the same `queryState`, the generated page renders one shared `FilterBar` / gating surface on the first table consumer in that group, or on the first metric when no table consumer exists
- `list.groupBy:` is optional and currently applies only to `data: readModel.<name>.list` table consumers
- `list.groupBy:` must contain result-field names that are also present in `list.columns`
- `list.groupBy:` fields cannot use relation-style projections and cannot also be marked `@sortable` in the current slice
- grouped table consumers must still leave at least one non-grouped offer column
- `list.pivotBy:` is optional and currently applies only to grouped `data: readModel.<name>.list` table consumers
- `list.pivotBy:` must reference one result field that also appears in `list.columns`
- `list.pivotBy:` cannot use relation-style projections and cannot also be marked `@sortable`
- pivoted grouped-matrix consumers must still leave at least one non-grouped, non-pivot offer column
- pivoted grouped-matrix consumers currently reject all `@sortable` columns
- grouped read-model table consumers are a narrow frontend presentation reuse for grouped result display; they do not add backend query syntax
- grouped read-model matrix consumers are the same kind of narrow frontend presentation reuse: they pivot already-fetched grouped rows into variant columns without widening backend query syntax
- read-model-backed `table` consumers may also set `dateNavigation:` with `field: <inputField>` plus optional `prevLabel` / `nextLabel`; this only shifts an existing string/date-like read-model input inside the current query state and does not widen backend query syntax
- in the current slice, user-facing frontend-family copy on resource `list.title` / `read.title`, navigation `group` / item `label`, `page.title`, `block.title`, page/create handoff `label`, and read-model `dateNavigation.prevLabel` / `nextLabel` accepts either a plain string or the shared descriptor shape `{ key?, defaultMessage?, values? }`
- this UI-copy descriptor slice stays narrow on purpose:
  - use plain strings for fixed copy
  - use descriptors when future i18n or literal interpolation matters
  - descriptor `values` in these UI-copy fields currently accept only scalar literals, not `{ ref: ... }`
- read-model-backed `table` consumers may also set `selectionState: <name>` to expose one selected row to narrow page-level handoff actions
- current frontend `readModel rules` consumption supports only:
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- current frontend `readModel rules` behavior stays narrow:
  - `eligibility` and `validate` gate the fetch locally and surface error messages on the generated page
  - `derive` runs over fetched rows client-side after fetch; it is not query pushdown
  - `derive` currently supports only scalar, non-`datetime` result fields
  - `allow/deny` auth entries are rejected in this frontend slice
- narrow handoff examples:

```yaml
page availability:
  title: "Flight Availability"
  actions:
    - create:
        resource: bookings
        label: "Book selected itinerary"
        seed:
          travelDate:
            input: availabilitySearch.outwardDate
          outwardFlightNo:
            selection: outwardFlight.flightNo
          homewardFlightNo:
            selection: homewardFlight.flightNo
  blocks:
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: outwardFlight
    - type: table
      title: "Homeward Flights"
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: homewardFlight
```

- current list-column surface stays narrow:
  - result fields only
  - no relation-style projections
  - no `@custom(...)`, `@fn(...)`, or `@expr(...)`
- grouped table consumers render grouped summary rows from `list.groupBy:` plus nested offer rows from the remaining list columns
- pivoted grouped-matrix consumers render grouped summary rows from `list.groupBy:`, use `list.pivotBy:` as dynamic variant columns, and render the remaining list columns inside each variant cell
- current table consumer may optionally add narrow row handoff actions:
  - only through `page` `table` blocks that use `data: readModel.<name>.list`
  - only `rowActions.create`
  - the target must be a generated resource `create:` view
  - `seed:` may reference `row.<resultField>`, `input.<inputField>`, or scalar literals
  - `seed:` may target only top-level scalar, enum, or `belongsTo(...)` fields that are already listed in the target resource `create.fields`
  - this slice is for single-row search/quote/result handoff into generated create starts, not for generic row-action authoring
- current pages may also add one narrow page-level create handoff over shared read-model selections:
  - only through `page.actions`
  - only `create:`
  - only when the same page already has `data: readModel.<name>.list` table blocks with `selectionState: <name>`
  - `create.seed` may reference `selection: <selectionState>.<resultField>`, `input: <queryState>.<inputField>`, or scalar literals
  - `selection:` must reference an existing `selectionState`
  - `input:` must reference an existing shared `queryState`
  - target fields stay limited to top-level scalar, enum, or `belongsTo(...)` fields already listed in the target resource `create.fields`
  - this slice is for dual-table or multi-table selected-result handoff into generated create starts, not for generic page action authoring
- do not invent generic query/join syntax around this slice

---

## `page <name>:` Block

Dashboard or custom pages with layout blocks.

```yaml
page dashboard:
  title: "System Overview"
  type: dashboard             # "dashboard" | "custom"
  layout: grid(2)             # grid(columns) layout
  blocks:
    - type: table
      title: "Users"
      data: users.list
    - type: metric
      title: "Total Users"
      data: query.users.count
    - type: chart
      title: "Active Sessions"
      data: query.sessions.daily
    - type: custom
      title: "Revenue"
      custom: "./components/RevenueChart.tsx"   # Escape hatch tier 3
```

### Block Types

| Type | Description |
|------|-------------|
| `metric` | Single KPI number; record-scoped relation pages may also use `data: <resource>.<hasManyField>.count`, and pages may also consume a named read-model count via `data: readModel.<name>.count` |
| `chart` | Chart/graph visualization |
| `table` | Inline data table; currently reuses an existing resource list via `data: <resource>.list` or a named read-model list via `data: readModel.<name>.list` |
| `custom` | **Escape hatch tier 3**: custom block component |

`table` block rules today:

- `data:` may use `resourceName.list`, for example `users.list`
- `data:` may also use `readModel.name.list`, for example `readModel.flightAvailability.list`
- named read-model table reuse requires the referenced read-model to define `list:`
- named read-model table reuse may also set `queryState: <name>` to share one query state with other read-model table/count consumers that have identical `inputs:`
- named read-model table reuse may also set `dateNavigation:`:
  - `field: <inputField>`
  - optional `prevLabel`
  - optional `nextLabel`
- named read-model table reuse may also set `selectionState: <name>` to expose one selected row to page-level create handoff
- named read-model table reuse may also declare narrow handoff actions through `rowActions:`
  - each action currently supports only `create:`
  - `create.resource` must reference a generated resource with `create:`
  - `create.seed` may reference only `row.<resultField>`, `input.<inputField>`, or scalar literals
  - `create.seed` may target only top-level scalar, enum, or `belongsTo(...)` fields already listed in the target `create.fields`
  - generated handoff links reuse the target create view and pass sanitized app-local `returnTo`
- pages may also declare narrow shared-selection handoff actions through `actions:`
  - each action currently supports only `create:`
  - `create.resource` must reference a generated resource with `create:`
  - `create.seed` may reference only `selection: <selectionState>.<resultField>`, `input: <queryState>.<inputField>`, or scalar literals
  - `selectionState` must come from an existing read-model-backed `table` block on that same page
  - `queryState` must come from an existing shared read-model query-state group on that same page
  - generated page-level handoff links reuse the target create view, disable themselves until all required selections exist, and pass sanitized app-local `returnTo`
- record-scoped relation pages may instead use `data: resourceName.hasManyField`, for example `teams.members`
- relation page routes must declare `path: /<resource>/:id/...` on the page
- relation page `data: <resource>.<hasManyField>` only supports direct `hasMany(..., by: ...)` fields
- the referenced target resource must exist
- if the target resource defines `list:` with columns, generated page tables reuse that target list's columns, relation-derived filters, sortable relation columns, pagination, and narrow `view` / `edit` / `create` / `delete` actions
- reused page-block `view` / `edit` / `create` actions pass sanitized app-local `returnTo`; on record-scoped relation pages `create` also seeds the inverse `belongsTo(...)` field into the target create view
- record-scoped relation pages themselves use sanitized app-local `returnTo` for Back when present and otherwise fall back to the parent resource read route or list route
- record-scoped relation pages also surface narrow parent `view` / `edit` header actions when those parent routes exist, and now also reuse a narrow parent workflow state/link in the generated header when that parent resource is workflow-linked; those links carry sanitized app-local `returnTo`
- if the target resource has no `list:` surface, generated page tables fall back to a simple related-record label-list keyed by the target label field
- current page-scoped params are only supported for these record-scoped relation table pages plus record-scoped relation count metric blocks; navigation/redirect targets do not bind page params yet
- custom blocks on the same record-scoped relation page may reuse that route context via generated props `{ recordId, returnTo, backHref, parentReadHref, parentEditHref, parentRecord, parentLoading, parentError, parentWorkflow, relations }`, where `parentWorkflow` is a narrow summary of the parent resource's already-linked workflow manifest when that parent is workflow-linked, and `relations` summarizes only the page's already-declared relation anchors while also carrying narrow `title` / `surfaceKind`, item-label / `view` / `edit` / `workflow` summaries plus workflow state labels, and `createHref` reuse when those existing anchors make them available

`metric` block rules today:

- generic metric/query surfaces are still placeholder-only beyond the now-landed named read-model count and record-scoped relation count consumers
- record-scoped relation pages may use `data: resourceName.hasManyField.count`, for example `teams.members.count`
- pages may also use `data: readModel.name.count`, for example `readModel.flightAvailability.count`
- `readModel.<name>.count` reuses the same query-state `FilterBar`, required-input gating, and frontend grouped-rules `eligibility` / `validate` checks as the table consumer, but remains a count-only surface with no row actions or relation projections
- named read-model count reuse may also set `queryState: <name>` to share one query state with other read-model table/count consumers that have identical `inputs:`
- the referenced read-model must exist; it does not need to define `list:`
- relation page routes must declare `path: /<resource>/:id/...` on the page
- relation page `data: <resource>.<hasManyField>.count` only supports direct `hasMany(..., by: ...)` fields
- the referenced target resource must exist; it does not need to define `list:`
- the generated page also uses sanitized app-local `returnTo` for Back when present and otherwise falls back to the parent resource read route or list route
- when the parent resource defines `read:` or `edit:`, the generated page header reuses those parent routes with sanitized app-local `returnTo`

Record-scoped relation page example:

```yaml
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count
    - type: table
      title: "Members"
      data: teams.members
```

---

## Expression Language (Rules)

Rules use a **constrained expression language** — NOT JavaScript.

### Supported

```
# Comparisons
currentUser.role == "admin"
record.status != "suspended"
record.count > 10

# Logical operators
hasRole(currentUser, "admin") && record.status == "active"
isOwner(currentUser, record) || hasRole(currentUser, "admin")
not isEmpty(record.name)

# Built-in functions
hasRole(subject, "roleName")    # Check role
isOwner(subject, record)        # Check ownership
isEmpty(field)                  # Check if empty
isNotEmpty(field)               # Check if not empty
count(collection)               # Count items
```

### NOT Supported (by design)

- Loops
- Variable assignment
- Arbitrary function calls
- Closures or imports
- Inline JavaScript

---

## Effect Language (onSuccess)

Effects are a finite set of side effects that execute after a successful action.

| Effect | Syntax | Description |
|--------|--------|-------------|
| `refresh` | `- refresh: resourceName` | Refresh/reload data |
| `invalidate` | `- invalidate: resourceName` | Invalidate cache |
| `toast` | `- toast: "message"` or descriptor object | Show notification |
| `redirect` | `- redirect: users.list` | Navigate to route |
| `openDialog` | `- openDialog: dialogName` | Open a modal |
| `emitEvent` | `- emitEvent: eventName` | Emit a custom event |

---

Current constraint:

- `toast` accepts either a static string or a descriptor object
- use a static string only for fixed copy; if values are inserted or future i18n matters, prefer the descriptor object immediately
- do not interpolate variables inside string messages
- descriptor `values` may contain only scalar literals or `{ ref: <path> }`
- supported `ref` roots today are:
  - `form.<field>`
  - `record.<field>` in edit views only
  - `user.<field>`
  - `params.id` in edit views only
- future i18n support should continue growing through structured descriptors, not inline template syntax inside frontend-family source files

Descriptor-shaped `toast` example:

```yaml
onSuccess:
  - toast:
      key: users.saved
      defaultMessage: "User {name} saved by {actor}"
      values:
        name:
          ref: form.name
        actor:
          ref: user.name
        count: 3
```

Not supported:

```yaml
- toast: "Saved {form.name}"
```

```yaml
- toast:
    key: users.saved
    values:
      name:
        expr: user.firstName + " " + user.lastName
```

## Style DSL (`.style.loj`)

Use `.style.loj` when shell-level visual intent is stable enough to stay out of raw CSS but does not belong in `.web.loj` business structure.

Current linking points:

- `app.style: '@style("./styles/theme")'`
- `page.style`
- `page.blocks[].style`
- `resource.list.style`
- `resource.read.style`
- `resource.create.style`
- `resource.edit.style`
- `resource.workflow.style` through `workflow: { source, style }`

Example:

```yaml
tokens:
  colors:
    surface: "#ffffff"
    border: "#d9dfeb"
    text: "#18212f"
    accent: "#0f5fff"
  spacing:
    sm: 8
    md: 16
    lg: 24
  borderRadius:
    md: 16
    lg: 24
  elevation:
    card: 3
    panel: 5
  typography:
    body:
      fontSize: 16
      fontWeight: 400
      lineHeight: 24
    heading:
      fontSize: 20
      fontWeight: 700
      lineHeight: 28

style pageShell:
  display: column
  gap: lg
  padding: lg
  typography: body
  color: text

style resultShell:
  extends: pageShell
  maxWidth: 1360
  backgroundColor: surface
  borderRadius: lg
  borderWidth: 1
  borderColor: border
  elevation: panel
  escape:
    css: |
      width: 100%;
      margin: 0 auto;
```

Current token groups:

- `colors`
- `spacing`
- `borderRadius`
- `elevation`
- `typography`

Current style properties:

- layout:
  - `display: row | column | stack`
  - `gap`
  - `padding`
  - `paddingHorizontal`
  - `paddingVertical`
  - `alignItems: start | center | end | stretch`
  - `justifyContent: start | center | end | spaceBetween | spaceAround`
- size:
  - `width`
  - `minHeight`
  - `maxWidth`
- surface:
  - `backgroundColor`
  - `borderRadius`
  - `borderWidth`
  - `borderColor`
  - `elevation`
- text:
  - `typography`
  - `color`
  - `opacity`
- inheritance:
  - `extends`
- escape:
  - `escape.css`

Token-reference rules:

- `gap`, `padding`, `paddingHorizontal`, `paddingVertical` resolve bare refs from `spacing`
- `borderRadius` resolve bare refs from `borderRadius`
- `elevation` resolve bare refs from `elevation`
- `backgroundColor`, `borderColor`, and `color` resolve bare refs from `colors`
- `typography` resolves bare refs from `typography`

Current style guardrails:

- keep `.style.loj` for shell-level style intent
- do not expect table internals, form sections, read-related panels, or responsive/mobile variants to have first-class hooks yet
- `escape.css` is the current narrow escape hatch for web-only styling details
- if a visual need is clearly DOM/CSS-structure-specific, prefer raw CSS escape rather than forcing it into the shared style layer

Current style escape example:

```yaml
style bookingListShell:
  extends: resultShell
  backgroundColor: surface
  elevation: panel
  escape:
    css: |
      background-image: linear-gradient(180deg, rgba(219, 232, 255, 0.35), rgba(255, 255, 255, 0.98));
```

Use `escape.css` for:

- gradients
- browser-specific decorative layering
- table/form/sidebar internals
- responsive details that are still outside the shared style contract

Do not use it to re-encode the whole shell when the shared style primitives already fit.

---

## Escape Hatch System (Two Axes)

When the DSL can't express something, use escape hatches. There are **two independent axes**:

### Logic Escape Hatches (for business logic)

#### @expr(...) — Pure TS Expression (safest, prefer this)
For inline logic that the built-in expression language can't handle. No statements, no imports, no side effects.
```yaml
rules:
  visibleIf: '@expr(currentUser?.role === "admin" && record?.status !== "archived")'
```

Current `@expr(...)` runtime context uses `currentUser`, `record`, and `formData`.

#### @fn(...) — External Function Reference
For logic too complex for an expression but not worth a full component. References a host function file.
```yaml
rules:
  allowIf: '@fn("./logic/canEditUser")'
```

Path resolution:

- extensionless `@fn("./logic/canEditUser")` is the preferred target-neutral logical id form
- in the current frontend-family target, extensionless logical ids resolve to `.ts` first, then `.js`
- explicit `.ts` / `.js` suffixes are still accepted, but they are treated as deliberate lock-in
- in a root file, `./logic/canEditUser` resolves from the root file directory
- in `resources/users.web.loj`, `./logic/canEditUser` resolves to `resources/logic/canEditUser.ts` or `.js`
- resolved files must stay inside the app project root
- do not keep both `.ts` and `.js` files for the same logical id; that is ambiguous and rejected

Rule function signature:

```ts
export default function canEditUser(context: {
  currentUser?: unknown;
  record?: unknown;
  formData?: unknown;
}) {
  return true;
}
```

### UI Escape Hatches (for custom rendering)

#### @custom(...) on Column — Custom Cell Renderer
```yaml
columns:
  - avatar @custom("./components/AvatarCell.tsx")
```
Props: `{ value, record }`

#### @custom(...) on Field — Custom Field Component
```yaml
fields:
  - avatar @custom("./components/AvatarUploader.tsx")
```

For `@custom(...)`, path resolution follows the same rule as `@fn(...)`: relative to the file that declares it.
Props: `{ value, onChange }`

#### custom: on Block — Custom Block Component
```yaml
blocks:
  - type: custom
    title: "Revenue"
    custom: "./components/RevenueChart.tsx"
```

Host-file dependency rules:

- custom `.ts` / `.tsx` / `.js` / `.jsx` escape files may use relative static imports to local helper scripts
- those escape files may also import external `.css` or `.module.css` files
- `rdsl build` / `rdsl dev` preserve those imported files in output and watch them for changes
- CSS stays outside frontend-family source files; do not paste raw CSS into the DSL
Props: self-managed by default; on record-scoped relation pages generated custom blocks receive `{ recordId, returnTo, backHref, parentReadHref, parentEditHref, parentRecord, parentLoading, parentError, parentWorkflow, relations }`, where `parentRecord` is typed to the parent resource model, `parentWorkflow` is either `null` or a narrow summary `{ field, currentState, currentStateLabel, workflowHref, steps, transitions }` when the parent resource is workflow-linked, and `relations` summarizes the page's already-declared relation anchors as `{ field, title, surfaceKind, targetResource, targetModel, count, items, createHref, loading, error }`; when the page already declares a relation table anchor, `surfaceKind` is `table` or `label-list` and `items` becomes a narrow array of `{ id, label, viewHref, editHref, workflowHref, workflowStateLabel }`, otherwise for count-only anchors `surfaceKind` is `count` and `items` stays `null`

### ⚠️ Escape Budget
The compiler tracks escape hatch usage. If more than ~20% of nodes use escape hatches, a warning is emitted — this signals a DSL design gap rather than healthy extension. **Always prefer the built-in DSL expression language first.**

---

## Complete Example

```yaml
app:
  name: "User Management"
  theme: dark
  auth: jwt
  navigation:
    - group: "System"
      visibleIf: hasRole(currentUser, "admin")
      items:
        - label: "Overview"
          icon: dashboard
          target: page.dashboard
        - label: "Users"
          icon: users
          target: resource.users.list

compiler:
  target: react

page dashboard:
  title: "System Overview"
  type: dashboard
  layout: grid(2)
  blocks:
    - type: metric
      title: "Total Users"
      data: query.users.count
    - type: chart
      title: "Active Sessions"
      data: query.sessions.daily

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  status: enum(active, suspended)
  createdAt: datetime @auto

resource users:
  model: User
  api: /api/users

  list:
    title: "User Management"
    filters: [email, role, status]
    columns:
      - name @sortable
      - email @sortable
      - role @tag(admin:red, editor:blue, viewer:gray)
      - status @badge(active:green, suspended:red)
      - createdAt @date
    actions:
      - create
      - edit
      - delete @confirm("Delete this user?")
    pagination: { size: 20, style: numbered }

  edit:
    fields:
      - name
      - email @disabled
      - role @select
    rules:
      enabledIf: hasRole(currentUser, "admin")
      allowIf: hasRole(currentUser, "admin")
    onSuccess:
      - refresh: users
      - toast: "User saved"

  create:
    fields: [name, email, role]
    onSuccess:
      - redirect: users.list
      - toast: "User created"
```

This ~65-line file generates **8 files, ~370 lines** of production-grade React/TypeScript.
