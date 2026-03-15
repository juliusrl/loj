# Loj

[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md)

**面向业务系统代码生成的 AI 原生同源 DSL 家族。**

`0.5.0 (Logos)`

> [!NOTE]
> **官方网站即将上线：** 我正在建设 [loj.org](https://loj.org)，它将作为交互式文档、在线演练场和社区案例展示的官方入口。

## 快速开始

```bash
npm install -g @loj-lang/cli
loj --help
```

如果不想全局安装：

```bash
npx @loj-lang/cli --help
```

Loj 是一个面向业务系统的 AI 原生 DSL 家族。它的目标不是通用的 vibe-coded 页面，而是用一组小而稳的、目标中立的原语来表达业务意图，再将它编译成框架侧最合适的前后端代码，并保留可追踪的 escape hatch。

目前公开仓库已经证明了三点：

- 一个 web-family DSL 可以生成真实的 React/TypeScript 前端
- 一个 api-family DSL 可以从同一份源码生成两种后端目标
- 一个 project shell 可以校验、构建并运行它们作为全栈应用

当前已实现的目标面：

- `.web.loj` 前端家族源码 -> `react/typescript`
- `.api.loj` 后端家族源码 -> `spring-boot/java/mvc-jpa-security`
- `.api.loj` 后端家族源码 -> `fastapi/python/rest-sqlalchemy-auth`
- `loj.project.yaml` -> 多目标 validate/build/dev 编排

当前 beta 周期保留的旧别名：

- `.rdsl` -> `.web.loj` 的前端家族旧别名
- `.sdsl` -> `.api.loj` 的后端家族旧别名

## 为什么做这个

相比冗长的命令式框架代码，LLM 更擅长处理窄的、声明式的、带 schema 约束的语言。Loj 的基本策略是：

- 尽量保持原语窄且目标中立
- 将框架差异下推到 `target + language + profile`
- 将 runtime、template 和 escape hatch 视为目标侧能力
- 保持源码紧凑、生成代码展开、工具链可追踪

也因此，同一份 `.api.loj` 业务语义现在已经可以同时编译到 Spring Boot 和 FastAPI。

## 当前能力

- web family：
  - resources、pages、read-models、workflows、linked rules、grouped/pivot table consumer
  - 通过 `.style.loj` 提供 shell-level 样式
  - app/page SEO metadata 与 asset refs
- api family：
  - models、resources、nested writes、read-models、workflows、linked rules
  - Spring Boot 和 FastAPI 生成
  - 面向只读 read-model 的窄 `@sql("./queries/x.sql")` escape
- project shell：
  - `loj validate`
  - `loj build`
  - `loj dev`
  - `loj rebuild`
  - `loj restart`
  - `loj status`
  - `loj doctor`
  - `loj stop`
  - 通过 `--target <alias>` 的单 target project-shell 流程
  - 通过 `loj.project.yaml` 进行 database/runtime/dev 编排

当前仓库更准确的描述是：**面向业务系统的、可公开演示的全栈 alpha**。

## 公开评估路径

如果你只想走一条评估路径，建议直接看 flight-booking proof：

```bash
npm install
npm run demo:loj:booking-proof:proof
```

这条路径会覆盖：

- shared-query 搜索流
- grouped result 消费
- workflow/wizard handoff
- nested aggregate writes
- linked rules
- 同一业务模型下的 Spring Boot 和 FastAPI 生成

如果你更想看偏 back-office 的垂直场景，可以运行：

```bash
npm run demo:loj:invoice:proof
```

如果你只想看最小全栈 baseline，可以运行：

```bash
npm run demo:loj
```

如果你想把 booking proof 或 user-admin baseline 切到 FastAPI：

```bash
npm run demo:loj:booking-proof:fastapi
npm run demo:loj:fastapi
```

## 快速开始

```bash
npm install

# 当前最强的业务系统 proof
npm run demo:loj:booking-proof:proof

# 更强的 back-office showcase
npm run demo:loj:invoice:proof

# 原始 baseline
npm run demo:loj
```

别犹豫，**Loj it! 🚀**

如果你想直接从 `loj.project.yaml` 工作，而不是用 repo 里的 demo script：

```bash
loj validate examples/fullstack-flight-booking-proof/loj.project.yaml
loj build examples/fullstack-flight-booking-proof/loj.project.yaml
loj dev examples/fullstack-flight-booking-proof/loj.project.yaml
loj rebuild examples/fullstack-flight-booking-proof/loj.project.yaml --target frontend
loj restart examples/fullstack-flight-booking-proof/loj.project.yaml --service host

# 单 target project-shell 流程
loj build examples/fullstack-flight-booking-proof/loj.project.yaml --target backend
```

## 极简心智模型

前端家族写法：

```yaml
resource users:
  model: User
  api: /api/users
  list:
    columns: [name, role, status]
  edit:
    fields: [name, role, status]
```

后端家族写法：

```yaml
resource users:
  model: User
  api: /api/users
  operations: [list, get, create, update, delete]
```

重点不在具体生成语法，而在于源码始终保持窄而稳定，而各目标端仍然可以输出最符合框架习惯的代码。

## CLI 详细参考

### 项目命令 (Project Commands)

这些命令通常作用于 `loj.project.yaml`，协调多个 target 的构建与运行。

- **`loj validate <project>`**: 校验整个项目的 DSL 定义、目标配置与环境变量。支持 `--json` 输出。
- **`loj build <project>`**: 构建整个项目的所有 target 输出。支持 `--json` 输出。
- **`loj dev <project>`**: 开启增强的开发模式，包含文件监控、增量构建与托管服务运行。
  - `--target <alias>`: 仅针对特定的 target（如 `backend`）启动开发流程。
  - `--debug`: 启用详细的调试日志。
  - 支持 `--json` 输出。
- **`loj rebuild <project>`**: 在当前活动的 `loj dev` 会话中排队一次手动重编。
  - `--target <alias>`: 仅重编指定 target（例如样式迭代时只重编 `frontend`）。
  - 支持 `--json` 输出。
- **`loj restart <project>`**: 在当前活动的 `loj dev` 会话中重启托管服务。
  - `--service <host|server|all>`: 只重启前端 host、只重启后端 server，或同时重启两者。
  - 支持 `--json` 输出。
- **`loj status <project>`**: 检查当前项目各服务的运行状态、地址、健康检查端点及调试器端口。支持 `--json` 输出。
- **`loj stop <project>`**: 停止当前正在运行的托管会话。支持 `--json` 输出。
- **`loj doctor <project>`**: 深入诊断开发环境，检查依赖完整性、编译产物链接与生成路径冲突。支持 `--json` 输出。

### 专项命令 (Individual Commands)

处理独立的 RDSL/SDSL 辅助产物：

- **`loj rules validate/build <file.rules.loj>`**: 针对独立规则文件进行校验或构建。支持 `--json` 与 `--out-dir`。
- **`loj flow validate/build <file.flow.loj>`**: 针对独立工作流文件进行校验或构建。支持 `--json` 与 `--out-dir`。

### Agent/Skill 管理

用于管理 AI 编程助手的领域技能包：

- **`loj agent install <provider>`**: 安装内置 Skill 到指定 IDE。
  - `<provider>`: `codex`, `windsurf` 或 `generic`。
  - `--scope <user|project>`: 安装到用户全局或项目本地。
- **`loj agent add <provider> --from <source>`**: 从本地路径或远端拉取并安装 Skill。
- **`loj agent export <provider> --out-dir <dir>`**: 导出内置的 Skill 原始包供手动集成。

## 命令口径

正常使用时，优先使用上述 `loj` project-shell 命令。

`rdsl` 和 `sdsl` 仍然存在，但它们现在更适合作为 family-local 工具，用于 compiler-focused 或 单 family 场景，不再是默认的公开入口。

## 仓库结构

```text
subprojects/
  rdsl/   web-family 工具链、文档和示例
  sdsl/   api-family 工具链、文档和示例
packages/
  loj-cli/            project-level orchestration CLI
  loj-vscode/         repo-level VSCode 插件
  loj-benchmark-core/ benchmark harness
examples/
  fullstack-user-admin/            全栈 baseline
  fullstack-invoice-backoffice/    更强的 back-office showcase
  fullstack-flight-booking-proof/  当前最强的业务系统 proof 路径
docs/
  repo-level 说明与 contract
```

## 下一步阅读

公开 authoring surface 建议从这里开始：

- [skills/loj-authoring/SKILL.md](./skills/loj-authoring/SKILL.md) — 面向 AI 的公开 Loj authoring skill
- [loj-project-file-contract.md](./docs/zh/loj-project-file-contract.md) — `loj.project.yaml` 编排规范
- [recommended-project-structure.md](./docs/zh/recommended-project-structure.md) — 推荐的项目目录结构
- [env-project-story.md](./docs/zh/env-project-story.md) — 环境变量与项目加载体系
- [rdsl-reference.md](./subprojects/rdsl/docs/zh/rdsl-reference.md) — 前端核心语法参考（`.web.loj`）
- [sdsl-reference.md](./subprojects/sdsl/docs/zh/sdsl-reference.md) — 后端核心语法参考（`.api.loj`）

skill 是公开的 AI 入口；两个 reference 仍然是语法真相源。

## 安装 Skill

如果你想为 Codex 类工作流安装公开的 `loj-authoring` skill：

```bash
# 安装到 user scope
npx @loj-lang/cli agent install codex

# 安装到 Windsurf 默认 skills 目录
npx @loj-lang/cli agent install windsurf

# 在项目内 vendoring 一份副本
npx @loj-lang/cli agent install codex --scope project

# 导出到任意目录
npx @loj-lang/cli agent export codex --out-dir ./tooling/skills

# 从本地或远程 skill bundle 源安装
npx @loj-lang/cli agent add codex --from ./tooling/skills/loj-authoring

# 直接从 GitHub Release 资产安装
npx @loj-lang/cli agent add codex --from https://github.com/juliusrl/loj/releases/download/v0.5.0/loj-authoring-0.5.0.tgz

# 安装到任意显式 skills 目录
npx @loj-lang/cli agent install generic --skills-dir ~/.my-agent/skills
```

当前直接拉取路径都通过已发布的 CLI 包：
- bundled 安装：`loj agent install ...`
- 远程/本地 bundle 安装：`loj agent add ...`

## VSCode 扩展

当前 VSCode Beta 通过 VSIX release asset 分发：

- `loj-vscode-0.5.0.vsix`

可从 GitHub Release 页面下载，然后在 VSCode 中执行：

- `Extensions: Install from VSIX...`

## 许可证

Apache 2.0
