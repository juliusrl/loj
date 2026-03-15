# @loj-lang/cli

Repo-level orchestration CLI for `loj.project.yaml`.

Current implemented commands:

- `loj validate`
- `loj build`
- `loj dev`
- `loj status`
- `loj stop`
- `loj doctor`
- `loj rules validate`
- `loj rules build`
- `loj flow validate`
- `loj flow build`
- `loj agent install <codex|windsurf|generic>`
- `loj agent add <codex|windsurf|generic> --from <source>`
- `loj agent export <codex|windsurf|generic> --out-dir <dir>`

This package coordinates sibling frontend and backend targets rather than replacing target-local CLIs.
Its agent commands only distribute the bundled `loj-authoring` skill; they do not replace the
canonical syntax docs or the manifest/inspect/trace contract.

Recommended project-shell loop:

```bash
# inspect dependencies, generated outputs, linked files, and current dev state
npx @loj-lang/cli doctor ./loj.project.yaml

# start the managed host/backend loop
npx @loj-lang/cli dev ./loj.project.yaml

# inspect current URLs, services, probes, and debugger endpoints
npx @loj-lang/cli status ./loj.project.yaml

# stop the active managed session
npx @loj-lang/cli stop ./loj.project.yaml
```

Examples:

```bash
# validate a standalone policy/rules proof file
npx @loj-lang/cli rules validate ./policies/invoice-access.rules.loj

# emit a target-neutral semantic manifest
npx @loj-lang/cli rules build ./policies/invoice-access.rules.loj --out-dir ./generated/rules

# validate a standalone workflow/state-machine proof file
npx @loj-lang/cli flow validate ./workflows/booking-process.flow.loj

# emit a shared workflow manifest
npx @loj-lang/cli flow build ./workflows/booking-process.flow.loj --out-dir ./generated/flow

# install into CODEX_HOME/skills or ~/.codex/skills
npx @loj-lang/cli agent install codex

# install into WINDSURF_HOME/skills or ~/.codeium/windsurf/skills
npx @loj-lang/cli agent install windsurf

# vendor a pinned project copy under ./.loj/agents/codex/skills
npx @loj-lang/cli agent install codex --scope project

# add a skill bundle from a local or remote source
npx @loj-lang/cli agent add codex --from ./tooling/skills/loj-authoring

# install into any explicit skills directory
npx @loj-lang/cli agent install generic --skills-dir ~/.my-agent/skills

# export into any custom directory
npx @loj-lang/cli agent export codex --out-dir ./tooling/skills
```

The current `.rules.loj` slice is intentionally narrow: one named rule set per file, grouped
`allow/deny`, `eligibility`, `validate`, and `derive` entries, standalone manifest emission
through `loj rules build`, plus narrow backend-family linkage through `resource auth.policy`,
`resource create.rules`, and `readModel rules`. It is still not orchestrated through
`loj.project.yaml`. The current `.flow.loj` slice is even narrower: standalone validate/build
only, with one `workflow <name>:` block compiling to a shared workflow manifest.

Local workspace commands:

```bash
npm run build --workspace=@loj-lang/cli
npm run test --workspace=@loj-lang/cli
```
