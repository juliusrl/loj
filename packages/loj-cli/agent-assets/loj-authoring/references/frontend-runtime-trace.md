# Frontend Runtime And Trace

Use this reference when the task involves generated React code, runtime assumptions, `rdsl inspect`,
or `rdsl trace`.

## Current Generated Target

- frontend-family currently generates `react + typescript`
- generated code imports direct subpaths from `@loj-lang/rdsl-runtime`
- generated code should not assume a barrel-export-only runtime contract

Current direct runtime import families used by generated code include:

- components:
  - `DataTable`
  - `GroupedDataTable`
  - `PivotDataTable`
  - `FilterBar`
  - `Pagination`
  - `FormField`
  - `ConfirmDialog`
  - `WorkflowSummary`
- hooks:
  - `useResource`
  - `useReadModel`
  - `useCollectionView`
  - `useGroupedCollectionView`
  - `useToast`
  - `useAuth`
  - `useDocumentMetadata`
  - navigation helpers under `hooks/navigation`
- policy helper:
  - `can`

## Runtime Assumptions

### `useResource(api)`

Generated CRUD flows assume `useResource` provides:

- `data`
- `allData`
- `loading`
- `error`
- `filters`, `setFilters`
- `sort`, `setSort`
- `pagination`, `setPagination`
- `getById`
- `createItem`
- `updateItem`
- `deleteItem`
- `refresh`

Resource records always have `id: string` at the frontend runtime surface.

Generated relation/page reuse still depends on `allData` for:

- relation-derived projections such as `team.name` / `members.count`
- record-scoped relation page filtering by inverse foreign key
- relation-aware create/edit/read back-link reuse

### `useReadModel(api, options)`

Generated read-model pages assume a fixed GET list-style contract and current helper behavior for:

- `data`
- `loading`
- `error`
- URL-backed query inputs
- required-input gating before fetch

Current read-model pages may also layer:

- shared `queryState`
- `dateNavigation`
- `selectionState`
- grouped/pivoted table presentation over fetched rows

### `useCollectionView(items, options)` / `useGroupedCollectionView(items, options)`

Generated list, related-panel, page-table, grouped-table, and grouped-matrix surfaces assume these
helpers provide:

- `data`
- `filters`, `setFilters`
- `sort`, `setSort`
- `pagination`, `setPagination`

Current rule:

- filtering, sorting, grouping, pivoting, and pagination are currently client-side after fetch
- relation-derived filters and sortable relation columns are applied over projected table data, not
  server-side joins

### `useToast()`

Generated code may call:

- `toast.success("Saved!")`
- `toast.success({ key, defaultMessage, values })`

Descriptor values stay scalar/deterministic.

### `useDocumentMetadata()`

Generated web metadata surfaces now assume runtime support for:

- `document.title`
- meta `description`
- canonical link
- `og:*` image/title/description-ish fields
- favicon

That support is driven by `.web.loj` `app.seo`, `page.seo`, and `@asset(...)`, not by ad hoc host code.

### Navigation helpers

Generated code now assumes runtime helpers for:

- app-local href construction
- sanitized `returnTo`
- current location/search parsing
- optional web `runtime.basePath` stripping/prefixing

Do not hand-edit generated code to bypass those helpers.

### `can(rule, context)`

Generated code uses `can()` only for built-in normalized rule ASTs.

It currently gates:

- `visibleIf`
- `enabledIf`
- linked grouped-rule eligibility/validation surfaces
- navigation visibility
- workflow step visibility

## Runtime Transport Baseline

The current frontend runtime accepts list responses shaped as:

- raw array
- `{ items: [...] }`
- `{ data: [...] }`

Single-record responses may be:

- raw object
- `{ item: {...} }`
- `{ data: {...} }`

Errors may be:

- non-2xx JSON with string `message`

Important current rule:

- server-driven pagination metadata is not required
- list pagination is currently derived client-side after fetch

## Browser Events

Generated code may emit:

- `rdsl:refresh`
- `rdsl:invalidate`
- `rdsl:open-dialog`

These are still part of generated-code/runtime integration.

## Trace And Inspect

Use:

- `rdsl inspect <entry.web.loj|build-dir> [--node <id>]`
- `rdsl trace <entry-or-build-dir> <generated-file:line[:col]>`

Current manifest split:

- `semantic-manifest.json`
- `trace-manifest.json`

Important trace concepts:

- `sourceFiles`
- `generatedFiles`
- `nodes`
- `regions`
- `hostFiles`

What they mean:

- `nodes`: semantic node catalog
- `regions`: generated file spans mapped back to semantic nodes
- `hostFiles`: copied escape-hatch files plus copied dependencies such as CSS and asset closures

## Authoring Guardrails

- When reviewing generated React code, validate it against these runtime contracts, not ad hoc
  assumptions.
- If a task is about generated-output bugs, check runtime contract mismatches first.
- If a task is about trace/inspect behavior, reason in terms of `semantic node -> generated region`,
  not line comments alone.
