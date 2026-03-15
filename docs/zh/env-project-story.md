# Loj 环境变量与项目体系 (Project Story)

## 当前状态

本文档描述了当前第二个 Beta 阶段已实现的基准功能。

当前已实现的基准：

- `loj validate`、`loj build` 和 `loj dev` 都会加载 `loj.project.yaml` 附近的常规项目环境变量文件。
- 支持共享环境变量文件：
  - `.env`
  - `.env.local`
- 支持特定 Target 的环境变量文件：
  - `.env.<target-alias>`
  - `.env.<target-alias>.local`
- `loj dev` 会监控这些环境变量文件，并在发生变化时重新加载 Target 会话以及托管的 Host/Server 进程。
- 项目范围内的 Host/Server 约定现在可以通过狭窄的 `LOJ_DEV_*` 环境变量层级进行覆盖。

仍处于有意延迟状态的功能：

- `loj.project.yaml` 内部的任意环境变量模板化。
- 在一个项目文件中包含多个 Host/Server 栈。
- 非约定的每个 Target 进程脚本化。

---

## 目的

环境变量方案应使本地全栈开发变得可预测，同时不将 `loj.project.yaml` 变成通用的部署配置文件。

它应该回答：

- 本地配置该放在哪里。
- 哪些值可以安全地提交（check in）。
- 哪些值保持本地私有。
- 共享与特定 Target 的环境变量如何传递到生成的 Target 中。

它不应将编排层变成一种 Shell 脚本 DSL。

---

## 文件发现

`loj` 会从 `loj.project.yaml` 所在的同一目录加载环境变量文件。

共享文件：

- `.env`
- `.env.local`

特定 Target 的文件：

- `.env.<target-alias>`
- `.env.<target-alias>.local`

示例：

```text
examples/fullstack-user-admin/
  loj.project.yaml
  .env
  .env.local
  .env.frontend
  .env.frontend.local
  .env.backend
  .env.backend.local
```

---

## 优先级

当前的优先级顺序为：

1. `.env`
2. `.env.local`
3. `.env.<target-alias>`
4. `.env.<target-alias>.local`
5. 调用进程的 Shell 环境变量

解释：

- 已提交的共享默认值存放在 `.env` 中。
- 机器本地的共享覆盖值存放在 `.env.local` 中。
- 已提交的 Target 默认值存放在 `.env.<target-alias>` 中。
- 机器本地的 Target 覆盖值存放在 `.env.<target-alias>.local` 中。
- 导出的 Shell 环境变量优先级仍然高于基于文件的环境变量。

---

## 狭窄的项目 Key

项目 Shell 当前识别一组小型的 `LOJ_DEV_*` Key：

- `LOJ_DEV_HOST`
- `LOJ_DEV_HOST_PORT`
- `LOJ_DEV_HOST_PREVIEW_PORT`
- `LOJ_DEV_API_BASE`
- `LOJ_DEV_PROXY_AUTH`
- `LOJ_DEV_SERVER_HOST`
- `LOJ_DEV_SERVER_PORT`

这些 Key 会覆盖原本来自 `dev.host` / `dev.server` 或当前默认值的常规本地体验值。

它们被有意限制在较窄的范围内：

- 不支持在 `loj.project.yaml` 内部进行任意 Key 插值。
- 不支持命令模板化。
- 项目文件中不包含通用的环境变量袋（env bag）。

---

## 特定 Target 的注入

每个 Target 会收到：

- 来自 `.env` / `.env.local` 的共享环境变量。
- 来自 `.env.<target>` / `.env.<target>.local` 的特定 Target 环境变量。

当前行为：

- `loj validate` 和 `loj build` 会将生效的 Target 环境变量传递到委派的 Target CLI 中。
- `loj dev` 会将生效的 Target 环境变量传递到委派的 Target 开发循环中。
- 托管的本地进程也会收到 Target 环境变量：
  - 前端 Host 收到前端 Target 环境变量。
  - 后端 Server 收到后端 Target 环境变量。

`loj dev` 还会向托管进程中注入一些由编译器拥有的本地变量，例如：

- `RDSL_GENERATED_DIR`
- `VITE_RDSL_API_BASE`
- `RDSL_PROXY_API_TARGET`
- `RDSL_PROXY_API_AUTH`
- `SERVER_ADDRESS`
- `SERVER_PORT`
- `LOJ_PROJECT_FILE`
- `LOJ_PROJECT_DIR`
- `LOJ_TARGET_ALIAS`
- `LOJ_TARGET_TYPE`

对于相同的 Key，由编译器拥有的变量优先级高于基于文件的环境变量。

---

## 项目文件边界

将这些内容保留在 `loj.project.yaml` 中：

- Target 成员关系
- Target 入口文件
- 输出目录
- Host/Server 拓扑结构
- 稳定的开发 Shell 结构

将这些内容保留在环境变量文件中：

- 本地代理凭证
- 本地 Host/Server 端口覆盖
- 特定 Target 的框架环境变量
- 机器特定的集成设置

**不要**将这些内容放在 `loj.project.yaml` 中：

- 应当避免的密码或 Token。
- 任意的每个 Target 环境变量袋。
- Shell 命令。
- 特定于部署的基础设施状态。

---

## 已提交 (Checked-In) 与本地 (Local)

推荐规则：

- 当数值不含秘密信息且有助于示例开箱即用时，可以提交 `.env`。
- `.env.local` 和 `.env.<target>.local` 应始终保持为本地私有。

当前的发布示例模式：

- `examples/fullstack-user-admin/.env` 已提交，因为演示使用的 Basic Auth 凭证仅是为了本地 MVP 开发的便利，并非真实的秘密场景。
- 真实的秘密材料仍应存放在仅限本地的环境变量文件中。

---

## 发布示例

当前的发布示例使用了：

- [loj.project.yaml](../examples/fullstack-user-admin/loj.project.yaml)
- [.env](../examples/fullstack-user-admin/.env)

这意味着：

- 拓扑结构保留在项目文件中。
- 本地代理认证信息保留在环境变量中。
- 除非被覆盖，否则默认的 Host/Backend 端口保持由约定驱动。

EOF
