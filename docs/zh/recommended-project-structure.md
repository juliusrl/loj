# 推荐项目结构

## 状态

这是一份建议，而非解析器或编译器的强制要求。

请将其作为以下情况的默认布局：

- 新的 `loj.project.yaml` 应用
- AI 编写的项目
- 未来的脚手架（scaffold/init）默认方案

不要将其视为唯一的合法仓库形式。

---

## 目的

代码库现在的覆盖面已经足够广，因此一个默认的目录形状是非常有用的：

- 它降低了 AI 编写时的偏移（drift）。
- 它为关联的 `@rules(...)`、`@flow(...)`、`@sql(...)`、`@style(...)` 和 `@asset(...)` 文件提供了一个可预测的归宿。
- 它保持了 `.web.loj`、`.api.loj`、`.rules.loj`、`.flow.loj`、`.style.loj` 以及 Host 逃生舱（escape）文件的关注点分离。

本文档确定的是推荐布局，而非强制布局。

---

## 推荐默认值

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

意图：

- `frontend/` 将 Web 家族源码、样式、SEO 资产引用以及前端逃生舱文件放在一起。
- `backend/` 将 API 家族源码、Read-model 处理器/查询以及后端策略/规则/工作流文件放在一起。
- `loj.project.yaml` 保留在应用根目录。

---

## 前端布局

推荐方案：

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

按角色使用这些文件夹：

- `models/` -> `model <Name>:`
- `resources/` -> `resource <name>:`
- `read-models/` -> `readModel <name>:`
- `pages/` -> `page <name>:`
- `rules/` -> 链接的 `.rules.loj`
- `workflows/` -> 链接的 `.flow.loj`
- `styles/` -> 链接的 `.style.loj`
- `components/` -> 前端 Host 逃生舱文件，如 `@custom(...)`
- `logic/` -> 前端 `@fn(...)` Host 辅助函数
- `assets/` -> `@asset(...)` 图片/favicon/OG 资产

---

## 后端布局

推荐方案：

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

按角色使用这些文件夹：

- `models/` -> `model <Name>:`
- `resources/` -> `resource <name>:`
- `read-models/` -> `readModel <name>:`
- `rules/` -> 链接的 `.rules.loj`
- `workflows/` -> 链接的 `.flow.loj`
- `handlers/` -> 后端 `@fn(...)` Read-model 处理器
- `policies/` -> 后端 `auth.policy: '@fn(...)'`
- `queries/` -> 后端 Read-model `@sql(...)`

---

## `loj.project.yaml`

推荐的根目录放置：

```text
my-app/
  loj.project.yaml
```

推荐的 Target 入口：

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

在此文件中保持数据库/运行时/开发编排，而不要放在 `.web.loj` / `.api.loj` 中。

---

## 命令推荐

对于常规的编写和生成产物工作，优先使用 Project-shell 命令：

```bash
loj validate loj.project.yaml
loj build loj.project.yaml
loj dev loj.project.yaml
loj doctor loj.project.yaml
```

当你仍然希望保持 Project-shell 的数据库/运行时 Profile 但只需要单侧工作时，使用 `--target <alias>`：

```bash
loj build loj.project.yaml --target backend
loj dev loj.project.yaml --target frontend
```

`rdsl` / `sdsl` 仍然有用，但它们现在是次要工具，用于：

- 纯粹的单家族工作
- 编译器/调试工作
- Project-shell 编排之外的本地低级校验

它们不应再作为向新用户展示的默认入口。

---

## 核心准则

- 此布局是推荐的，而非强制的。
- 请勿将文件夹名称硬编码到编译器语义中。
- 未来的脚手架/初始化命令应默认遵循此结构，但编写过程中应允许通过 `entry` 和相对路径链接文件进行自定义路径。
