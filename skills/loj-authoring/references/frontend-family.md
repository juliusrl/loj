# Frontend-Family Authoring (`.web.loj`, legacy `.rdsl`)

Use this reference when authoring or reviewing frontend-family source files.

## Defaults

- Prefer `.web.loj` for new files. Use `.rdsl` only for legacy edits.
- Current implemented compiler triple is:

```yaml
compiler:
  target: react
```

- Files are a strict YAML subset:
  - no anchors
  - no aliases
  - no merge keys
  - no custom tags

## File Shape

Root files may contain:

- `app:`
- optional `compiler:`
- optional `imports:`
- `model <Name>:`
- `resource <name>:`
- `readModel <name>:`
- `page <name>:`

Module files may contain:

- optional `imports:`
- `model <Name>:`
- `resource <name>:`
- `readModel <name>:`
- `page <name>:`

Module files may not contain `app:` or `compiler:`.

## Imports

- Use single-file for small demos.
- Split only when the app gets large:
  - `4+` models
  - `3+` resources
  - complex custom pages
- `imports:` entries must be relative `.web.loj` / `.rdsl` paths or directories ending in `/`.
- Nested imports are allowed.
- Import cycles are invalid.
- Directory imports expand direct child family files only, sorted lexicographically.

## `app:`

Example:

```yaml
app:
  name: "Flight Booking"
  theme: light
  auth: jwt
  style: '@style("./styles/theme")'
  seo:
    siteName: "Loj Air"
    defaultTitle: "Loj Air"
    titleTemplate: "{title} · Loj Air"
    defaultDescription: "Flight booking demo"
    defaultImage: '@asset("./assets/og-default.png")'
    favicon: '@asset("./assets/favicon.png")'
  navigation:
    - group:
        key: "nav.system"
        defaultMessage: "System"
      items:
        - label:
            key: "nav.users"
            defaultMessage: "Users"
          icon: users
          target: resource.users.list
```

Rules:

- `name` is required.
- `theme` is `light` or `dark`.
- `auth` is `none`, `jwt`, or `session`.
- `style` must use `@style("./styles/x")`.
- `seo` is optional and currently supports:
  - `siteName`
  - `defaultTitle`
  - `titleTemplate`
  - `defaultDescription`
  - `defaultImage`
  - `favicon`
- navigation targets are `page.<name>` or `resource.<name>.list`
- navigation `group` and item `label` currently accept either plain string or shared descriptor
  shape `{ key?, defaultMessage?, values? }`

## Current `MessageLike` / Descriptor Surfaces

In the current implemented `.web.loj` slice, these user-facing copy surfaces accept either:

- plain string
- shared descriptor shape `{ key?, defaultMessage?, values? }`

Current supported surfaces:

- `resource.list.title`
- `resource.read.title`
- navigation `group`
- navigation item `label`
- `page.title`
- `page.blocks[].title`
- page/create handoff `label`
- read-model `dateNavigation.prevLabel`
- read-model `dateNavigation.nextLabel`
- SEO-facing copy directions such as `app.seo.defaultTitle`, `app.seo.titleTemplate`,
  `app.seo.defaultDescription`, and `page.seo.description`

Current guardrails:

- use plain strings for fixed copy
- use descriptors when future i18n or scalar-literal interpolation matters
- descriptor `values` in these UI-copy surfaces currently accept only scalar literals, not
  `{ ref: ... }`
- do not assume every string field in `.web.loj` is `MessageLike`

## `model <Name>:`

Example:

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  teamId: belongsTo(Team)
  members: hasMany(Member, by: teamId)
  createdAt: datetime @auto
```

Types:

- `string`
- `number`
- `boolean`
- `datetime`
- `enum(a, b, c)`
- `belongsTo(Model)`
- `hasMany(Model, by: field)`

Decorators:

- `@required`
- `@email`
- `@unique`
- `@minLen(n)`
- `@auto`

Resource-backed records include implicit runtime `id: string`.

Relation rules:

- `belongsTo(Model)` is the narrow single-record relation field.
- `hasMany(Model, by: field)` is inverse metadata only; it does not generate a client model field.
- `hasMany(..., by: ...)` must point at a target-model field declared as
  `belongsTo(CurrentModel)`.
- `hasMany(...)` does not support field decorators.

## `resource <name>:`

Example:

```yaml
resource bookings:
  model: Booking
  api: /api/bookings

  list:
    title:
      key: "bookings.list.title"
      defaultMessage: "Bookings"
    style: listShell
    filters: [reference, status, member.name]
    columns:
      - reference @sortable
      - status @badge(DRAFT:gray, READY:blue, CONFIRMED:green)
      - member.name @sortable

  read:
    title: "Booking Details"
    style: detailShell
    fields:
      - reference
      - member.name

  create:
    style: formShell
    fields:
      - reference
      - status
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - seat
        rules: '@rules("./rules/passenger-create")'
    rules: '@rules("./rules/booking-create")'

  edit:
    style: formShell
    fields:
      - reference
      - status
    includes:
      - field: passengers
        fields:
          - id
          - name
          - seat
        rules: '@rules("./rules/passenger-edit")'
    rules: '@rules("./rules/booking-edit")'

  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: workflowShell
```

Current resource surface rules:

- `workflow:` is optional and may be either:
  - scalar `@flow("./workflows/x")`
  - mapping `{ source: '@flow("./workflows/x")', style: workflowShell }`
- `list.style`, `read.style`, `create.style`, `edit.style`, and `workflow.style` are optional
  shell-level style hooks only
- `list.title` / `read.title` currently accept plain string or descriptor
- `create.rules` / `edit.rules` may still use inline `visibleIf/enabledIf/allowIf/enforce`
  mappings or linked `@rules("./rules/x")`
- linked form rules currently support only:
  - `eligibility`
  - `validate`
  - `derive`
- frontend generated form consumers reject linked `allow/deny`
- linked `derive` currently supports only already-listed scalar form fields
- `create.includes` / `edit.includes` currently support one-level repeated-child forms over direct
  `hasMany(Target, by: field)` relations
- repeated-child include rules may also use linked `.rules.loj`
- generated `edit.includes` submits one-level diff semantics:
  - child rows with `id` update
  - child rows without `id` create
  - omitted existing child rows delete

Workflow-linked resource behavior today:

- linked workflow `model` must match the resource `model`
- linked workflow `field` must point to an `enum(...)` field on that model
- `wizard.steps` may set optional `surface: form | read | workflow`
- when omitted, the first wizard step defaults to `form` and later steps default to `workflow`
- create/edit/read/workflow surfaces derive narrow current/next-step summaries
- create/edit CTA labels become step-aware when a visible next step exists
- read and fixed `/:id/workflow` prioritize transitions that advance to the next visible step
- read/workflow also surface narrow `workflowStep` review handoff plus `Redo <previous step>`

## `readModel <name>:`

Example:

```yaml
readModel outwardFlightAvailability:
  api: /api/outward-flight-availability
  inputs:
    outwardDate: date @required
    cabin: enum(ECONOMY, BUSINESS) @required
  result:
    flightNo: string
    fareBrand: string
    quotedFare: number
  rules: '@rules("./rules/outward-flight-availability")'
  list:
    groupBy: [flightNo]
    pivotBy: fareBrand
    columns:
      - flightNo
      - fareBrand
      - quotedFare
```

Current read-model rules:

- `api:` is required and points at a fixed GET endpoint
- `rules:` is optional and must use `@rules("./rules/x")`
- `inputs:` and `result:` must be YAML mappings, not field lists
- `inputs:` and `result:` currently support only scalar and enum field types
- `list:` is required only for `data: readModel.<name>.list`
- current frontend-family consumers are:
  - page `table` blocks via `data: readModel.<name>.list`
  - page `metric` blocks via `data: readModel.<name>.count`
- current frontend `readModel rules` consumption supports only:
  - `eligibility`
  - `validate`
  - `derive`
- frontend `readModel rules` reject `allow/deny`
- `derive` runs client-side over fetched rows; it is not query pushdown

Grouped/table presentation today:

- `queryState: <name>` shares one URL-backed query state across multiple read-model consumers with
  identical `inputs:`
- `list.groupBy:` is optional on read-model table consumers
- `list.pivotBy:` is optional on grouped table consumers
- `dateNavigation:` may set `field`, optional `prevLabel`, and optional `nextLabel`
- `selectionState: <name>` exposes one selected row to page-level handoff actions

Current copy rule:

- `dateNavigation.prevLabel` / `nextLabel` accept plain string or descriptor
- descriptor `values` in these UI-copy fields currently accept only scalar literals

## `page <name>:`

Example:

```yaml
page availability:
  title: "Flight Availability"
  style: pageShell
  seo:
    description: "Search outbound and homeward flights"
    canonicalPath: "/availability"
    image: '@asset("./assets/availability-og.png")'
  actions:
    - create:
        resource: bookings
        label: "Book selected itinerary"
        seed:
          outwardFlightNo:
            selection: outwardFlight.flightNo
          travelDate:
            input: availabilitySearch.outwardDate
  blocks:
    - type: table
      title: "Outbound Flights"
      style: tableShell
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: outwardFlight
      dateNavigation:
        field: outwardDate
        prevLabel: "Previous day"
        nextLabel: "Next day"
    - type: metric
      title: "Matching flights"
      data: readModel.outwardFlightAvailability.count
      queryState: availabilitySearch
```

Current page rules:

- `page.title` accepts plain string or descriptor
- `page.style` is optional and must reference a named style from the linked `app.style` program
- `page.seo` is optional and currently supports:
  - `description`
  - `canonicalPath`
  - `image`
  - `noIndex`
- `blocks[].title` accepts plain string or descriptor
- `blocks[].style` is optional and shell-level only

Current block types:

- `metric`
- `chart`
- `table`
- `custom`

Current `table` block behavior:

- `data:` may use:
  - `<resource>.list`
  - `readModel.<name>.list`
  - `<resource>.<hasManyField>` on record-scoped relation pages
- read-model-backed table blocks may also declare:
  - `queryState`
  - `dateNavigation`
  - `selectionState`
  - narrow `rowActions.create`
- pages may also declare narrow `actions.create` handoff when those same pages already expose
  `selectionState`
- record-scoped relation pages may reuse target resource list columns/filters/pagination/actions when
  the target resource already defines `list:`

Current custom block rule:

- `custom` is still the strongest escape hatch tier
- record-scoped relation pages pass a narrow generated context object including `parentWorkflow` and
  `relations` summaries

## Style DSL (`.style.loj`)

Use `.style.loj` when shell-level visual intent is stable enough to stay out of raw CSS but does
not belong in `.web.loj` business structure.

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

Current token interpretation:

- `fontSize`: numeric px
- `lineHeight`: numeric px
- `fontWeight`: numeric CSS font-weight

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
- `borderRadius` resolves bare refs from `borderRadius`
- `elevation` resolves bare refs from `elevation`
- `backgroundColor`, `borderColor`, and `color` resolve bare refs from `colors`
- `typography` resolves bare refs from `typography`

Current style guardrails:

- keep `.style.loj` for shell-level style intent
- do not expect table internals, form sections, read-related panels, or responsive/mobile variants
  to have first-class hooks yet
- `escape.css` is the current narrow escape hatch for web-only styling details
- if a visual need is clearly DOM/CSS-structure-specific, prefer raw CSS escape rather than forcing
  it into the shared style layer

Proof-driven style guidance from the current flight-booking proof:

- avoid stacking two shell systems on the same surface
  - if a node already uses `loj-style-*`, do not also give that same node a heavy proof-local
    `.rdsl-block` card treatment
  - let `.style.loj` own the outer shell; use raw CSS for internals
- start from a compact business-UI token baseline
  - large `xl/xxl` spacing, large radii, and strong elevation can make generated form/table pages
    feel empty and inflated very quickly
  - prefer tighter tokens first, then expand only after seeing the composed page
- good `.style.loj` candidates:
  - page shell
  - page block shell
  - resource list/read/create/edit/workflow shell
- keep these in `escape.css` for now:
  - button alignment and oversized pill fixes caused by current host/runtime flex behavior
  - table overflow, table-cell density, and sticky-header tuning
  - empty-state presentation
  - filter-bar and form-grid internals
  - workflow summary internals
  - repeated-child include section internals
- if the visual bug comes from current generated DOM behavior rather than stable author-facing shell
  intent, do not propose a new `.style.loj` primitive first

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

## Combined Example: Shared Read-Model Query + Selection Handoff

```yaml
page availability:
  title: "Flight Availability"
  style: availabilityPageShell
  actions:
    - create:
        resource: bookings
        label: "Book selected itinerary"
        seed:
          outwardFlightNo:
            selection: outwardFlight.flightNo
          homewardFlightNo:
            selection: homewardFlight.flightNo
          travelDate:
            input: availabilitySearch.outwardDate
  blocks:
    - type: table
      title: "Outbound Flights"
      style: availabilityResultShell
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: outwardFlight
      dateNavigation:
        field: outwardDate
        prevLabel: "Previous day"
        nextLabel: "Next day"
    - type: table
      title: "Homeward Flights"
      style: availabilityResultShell
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: homewardFlight
```

## Combined Example: Resource Workflow + Style + Rules + Includes

```yaml
resource bookings:
  model: Booking
  api: /api/bookings

  list:
    title: "Bookings"
    style: bookingListShell
    columns:
      - reference @sortable
      - status @badge(DRAFT:gray, READY:blue, CONFIRMED:green, FAILED:red)

  read:
    title: "Booking Details"
    style: bookingDetailShell
    fields:
      - reference
      - status

  create:
    style: bookingFormShell
    fields:
      - reference
      - quotedFare
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - seat
        rules: '@rules("./rules/passenger-create")'
    rules: '@rules("./rules/booking-create")'

  edit:
    style: bookingFormShell
    fields:
      - reference
      - quotedFare
    includes:
      - field: passengers
        fields:
          - id
          - name
          - seat
        rules: '@rules("./rules/passenger-edit")'
    rules: '@rules("./rules/booking-edit")'

  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: bookingWorkflowShell
```

## Frontend Escape Hatches

Use escape hatches only when the current `.web.loj` slice cannot express the behavior directly.

Preferred order:

- built-in DSL
- `@expr(...)`
- `@fn(...)`
- `@custom(...)`

### `@expr(...)`

Use for pure boolean/value logic inside supported expression slots.

```yaml
edit:
  fields:
    - field: role
      rules:
        enabledIf: '@expr(currentUser?.role === "admin" && record?.status !== "archived")'
```

Rules:

- keep it pure and deterministic
- current runtime context is narrow:
  - `currentUser`
  - `record`
  - `formData`
  - `item` on repeated-child rows

### `@fn("./logic/x")`

Use when the logic is too complex for the shared expression language.

```yaml
edit:
  rules:
    allowIf: '@fn("./logic/canEditBooking")'
```

Path rules:

- extensionless logical ids are preferred
- frontend-family resolves extensionless logical ids to `.ts` first, then `.js`
- explicit `.ts` / `.js` suffixes are accepted as deliberate lock-in
- the path resolves relative to the `.web.loj` file that declares it

Current function shape:

```ts
export default function canEditBooking(context: {
  currentUser?: unknown;
  record?: unknown;
  formData?: unknown;
  item?: unknown;
}) {
  return true;
}
```

Current file-shape rule:

- frontend `@fn(...)` points at a normal `.ts` / `.js` host file with an exported default function
- it is not a function-body snippet
- a normal function declaration is expected
- imports are fine in principle because this is a normal host file, but keep helpers narrow and
  local if you want maximum portability

### `@custom("./components/x.tsx")`

Use for React-specific rendering/custom input surfaces.

Column custom cell:

```yaml
columns:
  - fareBrand @custom("./components/FareBrandCell.tsx")
```

Props:

- `{ value, record }`

Field custom component:

```yaml
fields:
  - seat @custom("./components/SeatPicker.tsx")
```

Props:

- `{ value, onChange }`

Block custom component:

```yaml
blocks:
  - type: custom
    title: "Recovery"
    custom: "./components/RecoveryPanel.tsx"
```

Props:

- self-managed by default
- on record-scoped relation pages, generated props may also include narrow `parentWorkflow` and
  `relations` summaries

Host-file rules:

- custom `.ts` / `.tsx` / `.js` / `.jsx` escape files may use relative static imports
- they may also import local `.css` / `.module.css`
- keep raw CSS inside host files, not inside `.web.loj`
- build/dev currently preserve those imported dependencies in generated output

## Commands

- `rdsl validate <entry.web.loj>`
- `rdsl build <entry.web.loj> --out-dir <dir>`
- `rdsl inspect <entry.web.loj|build-dir> [--node <id>]`
- `rdsl trace <entry.web.loj|build-dir> <generated-file:line[:col]>`

## Guardrails

- Do not invent generic query DSL or backend join syntax around `readModel`.
- Do not invent style hooks for table internals, form sections, or responsive/mobile variants beyond
  the current shell-level slice.
- Do not invent broader workflow/page router syntax beyond linked resource workflow surfaces.
- Do not leak React component APIs into `.web.loj`; keep React-specific escape code in `@custom`,
  `@fn`, or host-side files.
