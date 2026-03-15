# Policy / Rules Proof (`.rules.loj`)

Use this reference only for the current first-slice rules proof.

This is still a narrow surface. It is now wired into backend-family `.api.loj` through:

- `resource auth.policy: '@rules("./policies/x")'`
- `resource create.rules: '@rules("./rules/x")'`
- `readModel <name> rules: '@rules("./rules/x")'`

It is now also wired into frontend-family `.web.loj` through:

- `readModel <name> rules: '@rules("./rules/x")'`
- `resource create.rules: '@rules("./rules/x")'`
- `resource edit.rules: '@rules("./rules/x")'`
- `resource create.includes[].rules: '@rules("./rules/x")'`
- `resource edit.includes[].rules: '@rules("./rules/x")'`

It is still not orchestrated through `loj.project.yaml`.

## Current Scope

Implemented today:

- `.rules.loj` file suffix
- one named rule set per file
- parser + validator + target-neutral semantic manifest generation
- grouped rule entry kinds:
  - `allow/deny <operation>`
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- repo CLI entry:
  - `loj rules validate <file.rules.loj>`
  - `loj rules build <file.rules.loj> --out-dir <dir>`

Not implemented yet:

- workflow `.flow.loj`
- project-shell orchestration for rules targets
- broader frontend `.rules.loj` consumers beyond the current read-model plus generated create/edit form surfaces

## File Shape

Use one top-level block:

```yaml
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, FINANCE, SALES]

  allow update:
    when: currentUser.role == ADMIN
    or:
      - currentUser.id == record.accountManagerId

  deny delete:
    when: record.status == COMPLETED
    message:
      key: "invoice.delete.completed"
      defaultMessage: "Completed invoices cannot be deleted."
```

Rules:

- exactly one top-level `rules <name>:` block per file
- entry keys may be:
  - `allow <operation>`
  - `deny <operation>`
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- supported operations:
  - `list`
  - `get`
  - `create`
  - `update`
  - `delete`

## Supported Fields

Inside auth `allow ...` / `deny ...` blocks:

- required:
  - `when`
- optional:
  - `or`
  - `message`
  - `scopeWhen`
  - `scope`

Field rules:

- `when` must be a non-empty expression string
- `or` may be one string or a sequence of strings
- `message` may be:
  - one string
  - one descriptor object with `key`, `defaultMessage`, optional `values`
- `scopeWhen` and `scope` are allowed only on `list`
- if one of `scopeWhen` / `scope` is present, both must be present

Inside `eligibility <name>` / `validate <name>` blocks:

- required:
  - `when`
- optional:
  - `or`
  - `message`

Inside `derive <field>` blocks:

- required:
  - `value`
- optional:
  - `when`

## Expression Language

The current rules proof reuses the same constrained expression language used by core web-family
rules.

Use:

- comparisons like `==`, `!=`, `>`, `<`, `>=`, `<=`
- arithmetic like `+`, `-`, `*`, `/`
- logical `&&`, `||`, `not`
- dotted paths like `currentUser.role`, `record.status`
- membership like `currentUser.role in [ADMIN, SALES]`
- built-ins such as `hasRole(...)`, `isOwner(...)`, `isEmpty(...)`, `count(...)`

Do not use:

- raw JavaScript or Python
- statements, loops, imports, closures
- framework/runtime internals

## Current Command Path

Validate:

```bash
loj rules validate ./policies/invoice-access.rules.loj
```

Build manifest:

```bash
loj rules build ./policies/invoice-access.rules.loj --out-dir ./generated/rules
```

Current build output is a standalone semantic manifest JSON file. Treat it as the first proof
surface plus a few narrow backend-family linkage points, not as a finished cross-target rules
system.

## Hard Guardrails

- The only implemented `.api.loj` linkages are:
  - `resource auth.policy: '@rules("./policies/x")'`
  - `resource create.rules: '@rules("./rules/x")'`
  - `readModel <name> rules: '@rules("./rules/x")'`
- The implemented `.web.loj` linkages are:
  - `readModel <name> rules: '@rules("./rules/x")'`
  - `resource create.rules: '@rules("./rules/x")'`
  - `resource edit.rules: '@rules("./rules/x")'`
  - `resource create.includes[].rules: '@rules("./rules/x")'`
  - `resource edit.includes[].rules: '@rules("./rules/x")'`
- Current linkage boundaries:
  - `auth.policy` consumes only `allow/deny` auth entries
  - backend `create.rules` consumes only `eligibility` + `validate`
  - `readModel rules` consumes only `eligibility` + `validate` + `derive`
  - frontend `readModel rules` use `eligibility` / `validate` only for local fetch gating and `derive` only for client-side row derivation after fetch
  - frontend `create.rules` / `edit.rules` use `eligibility` for local generated-form gating, `validate` for local pre-submit checks, and `derive` only for top-level scalar generated fields already listed in the form
  - frontend `create.includes[].rules` / `edit.includes[].rules` use `eligibility` / `validate` for local repeated-child item gating and validation, and `derive` only for scalar child fields already listed in that include's `fields:`
  - frontend `readModel rules` reject `allow/deny` entries
  - frontend generated form consumers (`create.rules`, `edit.rules`, `create.includes[].rules`, `edit.includes[].rules`) all reject `allow/deny` entries
- Do not invent `type: rules` inside `loj.project.yaml` yet.
- Do not add workflow/state-machine syntax to `.rules.loj`.
- Keep rule authoring declarative and target-neutral.
