# Full-Stack Minimal Users Example

This is the smallest repo-level full-stack Loj example intended for README-level orientation.

Files:

- [frontend/app.web.loj](./frontend/app.web.loj) — minimal web-family source
- [backend/app.api.loj](./backend/app.api.loj) — minimal api-family source
- [loj.project.yaml](./loj.project.yaml) — project-shell wiring

It is intentionally smaller than `fullstack-user-admin` and avoids broader admin/workflow surface area.

To validate or build it from the repo root:

```bash
npm run exec --workspace=@loj-lang/cli -- validate examples/fullstack-minimal-users/loj.project.yaml
npm run exec --workspace=@loj-lang/cli -- build examples/fullstack-minimal-users/loj.project.yaml
```

To run it with the shared React host:

```bash
npm run ci:install-rdsl-host-deps
npm run exec --workspace=@loj-lang/cli -- dev examples/fullstack-minimal-users/loj.project.yaml
```

WSL note:

- This example ships with `.env` defaults that bind both host and backend to `0.0.0.0` for WSL -> Windows browser access.
- If Windows `localhost` forwarding is unstable, use the WSL IP directly:

```bash
hostname -I
```

Then open `http://<WSL_IP>:5176` in the Windows browser.
