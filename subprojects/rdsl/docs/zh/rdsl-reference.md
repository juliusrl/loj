# Lojban 范式 (前端家族 `.web.loj`) — LLM 参考文档

> **目的**：本文档是生成有效的前端家族 `.web.loj` 文件的唯一事实来源。
> 将此文档提供给任何 LLM，它应能按照 Lojban 范式中明确的指令，在第一次尝试时就生成正确的逻辑和 UI 结构。
>
> 如果您正在使用仓库本地的 AI Skill，请使用 [skills/loj-authoring/SKILL.md](../../../skills/loj-authoring/SKILL.md) 作为统一的工作流封装。
> 本文件保留为规范语法和契约参考。
>
> 旧版说明：`.rdsl` 在当前的 Beta 周期内仍是受支持的前端家族别名。
>
> 共享形态说明：当前端家族语法或生成的界面重用仓库其他地方也存在的稳定描述符形态时，规范的共享形式现在位于 [shared-compiler-contracts.md](../../../docs/shared-compiler-contracts.md) 中。当前前端家族的使用包括共享消息描述符、交接/种子描述符、只读模型页面消费者绑定、工作流元数据/摘要/映射别名、关系摘要以及记录范围的自定义区块上下文。`.web.loj` 编辑并不直接导入该包；此说明仅修复编译器/运行时契约边界。

## Schema 版本: 0.1.0

---

## 文件结构

前端家族源文件 (`.web.loj`，旧版 `.rdsl`) 是 **YAML 的严格子集**（不支持 anchors、aliases、merge keys 或自定义 tags）。

ReactDSL 支持两种项目形态：

- **单文件应用**：一个根 `.web.loj` 文件，包含 `app:`、可选的 `compiler:` 以及语义定义。
- **“根+模块”应用**：一个根 `.web.loj` 文件，包含可选的 `imports:` 以及语义模块文件，导入的模块可能还会导入其他模块。

单文件应用就是一个没有 `imports:` 的根文件。

**根文件**中的顶级键：

| 键 | 必填 | 描述 |
|-----|----------|-------------|
| `app:` | 是 | 应用配置：名称、主题、认证、导航 |
| `compiler:` | 否 | 代码生成配置：目前仅支持 `target: react` |
| `imports:` | 否 | 仅限根文件的列表，包含额外的前端家族模块文件 |
| `model <Name>:` | 是 (1+) | 带有字段和装饰器的数据模型定义 |
| `resource <name>:` | 是 (1+) | 绑定到模型和 API 端点的 CRUD 资源 |
| `page <name>:` | 否 | 仪表盘或自定义页面与布局区块 |

**模块文件**中的顶级键：

| 键 | 允许 | 描述 |
|-----|---------|-------------|
| `model <Name>:` | 是 | 数据模型定义 |
| `resource <name>:` | 是 | CRUD 资源定义 |
| `page <name>:` | 是 | 仪表盘/自定义页面定义 |
| `imports:` | 是 | 可选的传递性模块链接 |
| `app:` | 否 | 仅限根文件 |
| `compiler:` | 否 | 仅限根文件 |

目前的多文件支持有意保持精简：

- 导入必须是相对 `.web.loj` / `.rdsl` 文件路径，或以 `/` 结尾的相对目录
- 允许嵌套导入
- 导入循环是无效的，并会通过导入链报告
- 导入的定义会合并到一个应用全局命名空间中
- 仍只有一个规范的入口文件，其中包含唯一的 `app:` 和 `compiler:` 区块
- 目录导入仅展开其直接子级的前端家族源文件，按字典序排序

跨文件的重复模型/资源/页面名称属于错误。

推荐默认方案：

- 小型演示和提示词规模的应用：单文件
- 大型管理/工作流应用：按领域使用 `imports:` 拆分

---

## `app:` 区块

```yaml
app:
  name: "My Admin"          # 应用标题 (字符串, 必填)
  theme: dark                # "dark" | "light" (默认: "light")
  auth: jwt                  # "jwt" | "session" | "none" (默认: "none")
  navigation:                # 侧边栏导航组
    - group: "Section Name"
      visibleIf: <expr>      # 可选: 可见性规则
      items:
        - label: "Page Title"
          icon: dashboard     # 图标名称
          target: page.dashboard       # page.<name> 或 resource.<name>.list
```

---

## `compiler:` 区块

仅将此区块用于代码生成设置。不要在此处放置业务逻辑、运行时认证或 API 信息。

```yaml
compiler:
  target: react   # 可选。默认值: react。v0.1 仅支持 "react"。
```

`compiler:` 区块的存在是为了让 DSL 以后可以增长到多个目标平台，而不会使 `app:` 过载。在 schema `0.1.0` 中，除 `react` 以外的任何值均为无效。
未来的架构版本可能会分离目标家族、实现语言和配置文件 (profile)，但这些额外的键尚未包含在 `0.1.0` 中。
UI 框架集成（如 Ant Design）最终应作为在 `target: react` 之上的附加 profile/运行时包落地，而不是作为单独的 DSL 方言。

---

## `imports:` 区块

使用 `imports:` 进行显式的模块链接。根文件仍是唯一可以包含 `app:` 和 `compiler:` 的文件。

```yaml
imports:
  - ./models/user.web.loj
  - ./resources/users.web.loj
  - ./pages/dashboard.web.loj
```

规则：

- 每个条目必须是相对 `.web.loj` / `.rdsl` 文件路径，或者是以后缀 `/` 结尾的相对目录路径
- 导入顺序不改变语义含义
- 导入的文件与根文件共享全局命名空间
- 模块文件可以包含它们自己的 `imports:`
- 导入循环是无效的
- 目录导入仅展开按字典序排序的直接子级前端家族源文件
- 目录导入不是递归的
- 根文件仍可以保留本地的 `model`、`resource` 和 `page` 定义
- 模块文件内部的逃生舱路径相对于该模块文件解析，而不是根文件

推荐拆分策略：

- `1-3` 个模型和 `1-2` 个资源：保留单个文件
- `4+` 个模型或 `3+` 个资源：按领域拆分
- 带有多个区块的自定义页面：为该页面提供独立的文件

---

## `model <Name>:` 区块

定义数据形状。每个字段都有一个类型和可选的装饰器。

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  status: enum(active, suspended)
  createdAt: datetime @auto
```

资源支持的记录包含一个隐式的运行时字段：

```yaml
id: string   # 自动生成，用于路由、编辑和行操作
```

不要在 `fields:` 中列出 `id`，除非您明确希望在视图中公开它。

### 字段类型

| 类型 | TypeScript | 描述 |
|------|------------|-------------|
| `string` | `string` | 文本字段 |
| `number` | `number` | 数字字段 |
| `boolean` | `boolean` | 布尔值 |
| `datetime` | `string` (ISO) | 日期/时间 |
| `enum(a, b, c)` | `'a' \| 'b' \| 'c'` | 枚举值 |
| `belongsTo(Model)` | `string \| number \| null` | 到另一个模型的外部关联 style 关系 |
| `hasMany(Model, by: field)` | 仅限元数据 | 派生的反向关系元数据；尚未发射到生成的客户端模型类型中 |

### 字段装饰器

| 装饰器 | 描述 |
|-----------|-------------|
| `@required` | 字段不能为空 |
| `@email` | 必须是有效的电子邮件格式 |
| `@unique` | 值必须唯一 |
| `@minLen(n)` | 最小字符串长度 |
| `@auto` | 自动生成 (例如时间戳) |

关系规则：

- `belongsTo(Model)` 要求 `Model` 存在
- `hasMany(Model, by: field)` 要求 `Model` 存在，且 `by:` 指向目标模型上的一个 `belongsTo(CurrentModel)` 字段
- 当前前端家族切片将 `belongsTo(...)` 字段视为生成的表单中的关联记录 ID
- 当关联资源存在时，生成的创建/编辑视图将 `belongsTo(...)` 字段渲染为选择输入
- 生成的创建视图还会从同名查询参数中预填充匹配的 `belongsTo(...)` 字段，并在存在时使用清洗过的应用本地 `returnTo` 作为取消目标
- 如果生成的创建视图没有声明显式的重定向效果，则该清洗过的 `returnTo` 将成为默认的创建后重定向目标
- 生成的编辑视图在存在时使用清洗过的应用本地 `returnTo` 作为取消目标
- 如果生成的编辑视图没有声明显式的重定向效果，则该清洗过的 `returnTo` 将成为默认的编辑后重定向目标
- 生成的读取视图在存在时使用清洗过的应用本地 `returnTo` 作为返回目标，并在链接到编辑时保留它
- 生成的 Web 列表列、列表过滤器和可排序列表列在关联资源存在时，可以使用精细的关系派生投影，如 `team.name` 和 `members.count`
- 生成的 `read:` 视图可以在 `fields:` 中使用相同的精细关系派生投影
- 生成的 `read.related:` 接受直接的 `hasMany(..., by: ...)` 字段名，如 `members`
- 当关联资源具有 `list:` 视图时，生成的 `read.related:` 面板重用其列、过滤器、可排序关系列、分页和精细的查看/编辑/创建/删除操作；否则，它们将退回到简单的标签列表，该列表链接到生成的查看，然后是生成的编辑，最后是关联了工作流时的固定工作流页面，同时在存在工作流元数据时显示目标工作流状态标签
- 这些重用的关系查看/编辑/创建操作将清洗过的应用本地 `returnTo` 传回源关系界面
- 重用的关系创建操作还会将反向 `belongsTo(...)` 字段预填充到目标创建视图中
- 生成的记录范围的关系页面可以在页面表格区块中使用 `page.path: /<resource>/:id/...` 加上 `data: <resource>.<hasManyField>`，以便在存在时重用相关资源的 `list:` 界面，否则退回到简单的相关记录标签列表
- 重用创建操作的页面表格区块传递清洗过的应用本地 `returnTo`；记录范围的关系页面表格区块还会预填充反向 `belongsTo(...)` 字段
- 生成的记录范围的关系页面还可以在指标区块中使用 `data: <resource>.<hasManyField>.count` 来渲染精细的相关记录计数，而无需开启查询语法
- 生成的记录范围的关系页面本身在存在时使用清洗过的应用本地 `returnTo` 作为返回目标，否则退回到父资源读取路由或列表路由
- 生成的记录范围的关系页面还在这些父路由存在时提供精细的父级查看/编辑标题操作；这些链接携带清洗过的应用本地 `returnTo`
- `hasMany(...)` 仅作为反向元数据；它不会作为生成的客户端模型字段发射，也不能直接用于生成的列表/过滤器/创建/编辑/读取字段界面
- `hasMany(...)` 反向字段不支持字段装饰器

---

## `resource <name>:` 区块

将模型绑定到 API 并定义 CRUD 视图。

```yaml
resource users:
  model: User                # 对模型名称的引用
  api: /api/users            # API 端点 (字符串, 必填)

  list:                      # 列表/表格视图
    title: "User Management"
    style: listShell
    filters: [email, role, team.name]   # 可过滤的字段
    columns:                 # 表格列
      - name @sortable
      - email @sortable
      - team.name @sortable
      - members.count @sortable
      - role @tag(admin:red, editor:blue, viewer:gray)
      - status @badge(active:green, suspended:red)
      - createdAt @date
    actions:                 # 可用的操作
      - create
      - view
      - edit
      - delete @confirm("Are you sure?")
    pagination: { size: 20, style: numbered }

  read:                      # 生成的读取/详情界面
    title: "User Details"
    style: detailShell
    fields:
      - name
      - team.name

  edit:                      # 编辑表单视图
    style: formShell
    fields:
      - name
      - email @disabled
      - role @select
    rules:
      visibleIf: <expr>      # 显示/隐藏表单
      enabledIf: <expr>      # 启用/禁用表单
      allowIf: <expr>        # 守护表单提交
      enforce: <expr>        # 同时也必须在服务端检查
    onSuccess:
      - refresh: users
      - toast: "Saved!"

  create:                    # 创建表单视图
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

当前关联的 `.rules.loj` 表单规则：

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

当前的 `workflow:` 规则：

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: workflowShell
```

- `workflow:` 是可选的，可以是一个标量 `@flow("./workflows/x")` 链接，或者是一个带有 `source:` 和可选 `style:` 的映射
- 推荐使用无扩展名的逻辑 ID 用于 `workflow:`
- 关联的工作流 `model` 必须与资源 `model` 匹配
- 关联的工作流 `field` 必须指向该模型上的一个 `enum(...)` 字段
- 关联的工作流必须声明该字段的每个枚举值，并且每个声明的工作流状态必须存在于该枚举中
- 受工作流控制的枚举字段不能作为普通生成的 `create.fields` 或 `edit.fields` 条目出现，除非您故意使用自定义字段逃生舱

当前样式附加规则：

- `list.style`、`read.style`、`create.style` 和 `edit.style` 是可选的，必须引用关联的 `app.style` 程序中的命名样式
- 当 `workflow:` 使用映射形式时，`workflow.style` 遵循相同的规则
- 第一波样式钩子仅附加到对应界面的生成根外壳中；它们尚未提供独立的 `table`、`form section` 或 `read.related` 样式钩子

当前 `create.includes` / `edit.includes` 规则：

- `includes:` 在生成的 `create:` 和生成的 `edit:` 中都是可选的
- 每个条目必须引用资源模型上的直接 `hasMany(Target, by: field)` 关系
- 每个条目可以可选地设置 `minItems: <非负整数>` 以在生成的表单中预填充重复的子行
- 子级 `fields:` 必须属于关联的目标模型
- 反向 `by:` 字段被自动预填充，不得再次列出
- 子级 `fields:` 目前可以使用子模型上的标量、枚举或 `belongsTo(...)` 字段
- 子级 `fields:` 不得使用 `hasMany(...)`
- `edit.fields`、`create.fields`、`create.includes[].fields` 和 `edit.includes[].fields` 可以使用带有 `field:` 的对象条目，以及精细的字段级 `rules.visibleIf` / `rules.enabledIf`
- 字段级规则重用相同的共享表达式语言：
  - 创建/编辑根字段可以引用 `currentUser`、`formData`，以及仅在编辑中的 `record`
  - 重复的子字段可以引用 `currentUser`、`formData` 和 `item`，以及编辑中的 `record`
- 当前切片在生成的创建/编辑表单中渲染重复的子区域，并带有生成的添加/删除控件和 `minItems` 底限强制执行
- `create.includes[].rules` 和 `edit.includes[].rules` 也可以使用 `rules: '@rules("./rules/x")'`
- 生成的 `edit.includes` 现在通过关联的目标资源加载现有的子行，并提交单层差分负荷：
  - 带有 `id` 的子行更新
  - 不带 `id` 的子行创建
  - 省略的现有子行删除
- 当前切片仍不支持更深的子级嵌套或任意嵌套突变语法

当前关联的表单规则行为：

- `edit.rules` 和 `create.rules` 仍可以使用带有 `visibleIf` / `enabledIf` / `allowIf` / `enforce` 的内联映射
- 它们也可以使用 `rules: '@rules("./rules/x")'`
- 当前前端关联的表单规则消费仅支持：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- 关联的 `allow/deny` 条目在生成的创建/编辑界面上被拒绝
- 关联的 `eligibility` 在本地门控生成的界面，并显示生成的错误界面而不是渲染表单
- 关联的 `validate` 在提交前在本地运行，并显示生成的验证消息
- 关联的 `derive` 目前仅支持已列在 `create.fields` / `edit.fields` 中的顶级标量生成表单字段
- 关联的派生目标在当前切片中被渲染为生成的只读字段
- 关联的创建规则可以引用 `currentUser` 和 `formData`
- 关联的编辑规则可以引用 `currentUser`、`formData` 和 `record`
- 关联的重复子级包含规则可以引用：
  - `create.includes[].rules` 中的 `currentUser`、`formData`、`item`
  - `edit.includes[].rules` 中的 `currentUser`、`formData`、`item`、`record`
- 关联的重复子级包含规则仅支持：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- 关联的重复子级 `derive` 目前仅支持已列在该包含的 `fields:` 中的标量生成子字段
- 关联的表单消费者仍未开启命令式事件处理语法

### 列装饰器

| 装饰器 | 描述 |
|-----------|-------------|
| `@sortable` | 列可以排序 |
| `@date` | 格式化为日期 |
| `@tag(key:color, ...)` | 渲染为彩色标签 |
| `@badge(key:color, ...)` | 渲染为状态徽章 |
| `@custom("./path.tsx")` | **逃生舱第 1 级**：自定义单元格渲染器 |

### 字段装饰器 (在 edit/create 中)

| 装饰器 | 描述 |
|-----------|-------------|
| `@select` | 渲染为下拉选择 |
| `@disabled` | 字段为只读 |
| `@custom("./path.tsx")` | **逃生舱第 2 级**：自定义字段组件 |

`read.fields:` 重用来自列表列的显示装饰器，除了 `@sortable`。

### 操作

| 操作 | 描述 |
|--------|-------------|
| `create` | 显示“创建”按钮 |
| `view` | 当资源具有 `read:` 视图时，每行显示“查看”操作 |
| `edit` | 每行显示“编辑”操作 |
| `delete` | 每行显示“删除”操作 |
| `delete @confirm("msg")` | 带确认对话框的删除 |

相关面板示例：

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

如果相关资源也定义了 `list:`，则生成的面板重用该目标列表的列、过滤器、可排序关系列、分页和精细的查看/编辑/创建/删除操作。
当该重用的操作界面包含查看、编辑或创建时，生成的链接会添加清洗过的应用本地 `returnTo`，以便目标查看/编辑/创建界面可以返回到面板或相关页面。重用的关系创建还会将反向 `belongsTo(...)` 字段预填充到目标创建视图中。如果生成的创建/编辑视图没有显式的重定向效果，则相同的 `returnTo` 将成为默认的提交后重定向目标。
生成的应用还会为每个 `read.related` 条目在 `/:id/related/<field>` 处添加记录范围的相关集合路由。

工作流关联的资源还在生成的创建/编辑/查看界面中重用关联的 `.flow.loj` 清单：

- 创建显示初始工作流状态以及可见的工作向导步骤
- `wizard.steps` 现在也可以设置可选的 `surface: form | read | workflow`；当省略时，第一步默认为 `form`，后续步骤默认为 `workflow`
- 创建还从这些可见的工作向导步骤中派生精细的当前/下一步摘要，在存在可见的下一步时将主要提交按钮升级为 `创建并继续执行 <下一步>`，并且当没有显式的重定向效果或应用本地 `returnTo` 存在时，成功提交后默认进入下一步声明的界面（`form` -> 生成的编辑，`read` -> 生成的查看，`workflow` -> 固定工作流页面），以固定工作流页面为备选
- 编辑显示当前工作流状态以及可见的工作向导步骤，派生相同的精细当前/下一步摘要，在存在可见的下一步时将主要提交按钮升级为 `保存并继续执行 <下一步>`，现在还提供指向固定工作流页面的精细 `工作流` 链接，并且当没有显式的重定向效果或应用本地 `returnTo` 存在时，成功提交后默认进入相同的下一步界面解析
- 查看显示当前工作流状态、可见的工作向导步骤、精细的当前/下一步摘要、在请求后续评审步骤时提供精细生成的 `workflowStep` 交接，以及在存在先前可见步骤时提供精细的 `重新执行 <上一步>` 链接；它现在优先处理推进到下一个可见向导步骤的转换，然后才渲染发布到 `/api/.../{id}/transitions/{transition}` 的其他允许转换操作；在成功转换后，生成的界面现在在界面发生变化时也会重定向到下一个可见向导步骤声明的界面
- 生成的列表/查看/表格渲染现在还对受工作流控制的枚举字段重用工作流状态标签，而不是仅显示原始枚举值
- 资源支持的表格消费者现在还提供精细的 `工作流` 行操作，它携带清洗过的应用本地 `returnTo` 链接到固定工作流页面
- 生成的路由还在 `/:id/workflow` 处添加了固定资源工作流页面，重用相同的工作流关联清单用于当前状态摘要、精细的当前/下一步摘要、向导步骤进度、下一步优先的转换操作、精细的 `workflowStep` 评审交接、`重新执行 <上一步>` 导航、转换后下一步界面交接、当存在查看视图时从现有 `read.related` 锚点派生的精细关联界面摘要、当存在查看视图时生成的 `read.fields` 记录上下文详情加生成的 `read.related` 面板上下文、当关联的目标没有生成的查看/编辑界面时提供简单的标签列表备选链接加工作流状态标签、以及带有清洗过的应用本地 `returnTo` 的精细 `查看` / `编辑` / `返回` 链接

当前工作流约束：

- 目前工作流关联仍仅限于资源级；工作流页面路由是从该关联生成的，而不是单独创作的，因此不要在 `.web.loj` 中虚构自定义页面级向导路由、项目外壳工作流目标或路由器/状态机库词汇

---

## `readModel <name>:` 区块

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

当前 `readModel` 规则：

- `readModel <name>:` 是 `.web.loj` 中的顶级区块
- `api:` 是必填的，指向一个固定的 GET 端点
- `rules:` 是可选的，必须使用 `@rules("./rules/x")`
- `inputs:` 和 `result:` 必须是 YAML 映射，而不是字段列表
- `inputs:` 和 `result:` 目前仅支持标量和枚举字段类型
- `list:` 仅在使用 `data: readModel.<name>.list` 时必填；仅当通过 `data: readModel.<name>.count` 使用指标消费者时不需要它
- 当前前端家族消费者是通过 `data: readModel.<name>.list` 的页面表格区块和通过 `data: readModel.<name>.count` 的页面指标区块
- 这些生成的页面界面使用来自 `inputs:` 的查询状态 `FilterBar` 输入、URL 支持的读模型范围查询状态、以及在首次获取前的必填输入门控；表格消费者还在获取的行上添加本地排序/分页，而指标消费者保持仅限计数
- 读模型页面消费者还可以设置 `queryState: <name>`，以便在具有相同 `inputs:` 的多个读模型消费者之间共享一个 URL 支持的查询状态
- 当多个读模型消费者共享相同的 `queryState` 时，生成的页面在该组中的第一个表格消费者上，或者在没有表格消费者时在第一个指标上，渲染一个共享的 `FilterBar` / 门控界面
- `list.groupBy:` 是可选的，目前仅适用于 `data: readModel.<name>.list` 表格消费者
- `list.groupBy:` 必须包含也出现在 `list.columns` 中的结果字段名称
- 在当前切片中，`list.groupBy:` 字段不能使用关系 style 投影，也不能标记为 `@sortable`
- 分组表格消费者必须仍保留至少一个非分组的报价列
- `list.pivotBy:` 是可选的，目前仅适用于分组的 `data: readModel.<name>.list` 表格消费者
- `list.pivotBy:` 必须引用一个也出现在 `list.columns` 中的结果字段
- `list.pivotBy:` 不能使用关系 style 投影，也不能标记为 `@sortable`
- 透视分组矩阵消费者必须仍保留至少一个非分组、非透视的报价列
- 透视分组矩阵消费者目前拒绝所有 `@sortable` 列
- 分组读模型表格消费者是用于分组结果显示的精细前端展示重用；它们不添加后端查询语法
- 透视分组矩阵消费者是同一种精细的前端展示重用：它们将已获取的分组行透视为变体列，而不会拓宽后端查询语法
- 读模型支持的表格消费者还可以设置 `dateNavigation:`，包含 `field: <inputField>` 以及可选的 `prevLabel` / `nextLabel`；这仅在当前查询状态内切换现存的字符串/日期类读模型输入，而不会拓宽后端查询语法
- 在当前切片中，资源 `list.title` / `read.title`、导航 `group` / 项目 `label`、`page.title`、`block.title`、页面/创建交接 `label` 以及读模型 `dateNavigation.prevLabel` / `nextLabel` 上的用户侧前端家族文案接受纯字符串或共享描述符形态 `{ key?, defaultMessage?, values? }`
- 此 UI 文案描述符切片有意保持精细：
  - 对固定文案使用纯字符串
  - 当未来的国际化或字面插入很重要时使用描述符
  - 这些 UI 文案字段中的描述符 `values` 目前仅接受标量字面量，不接受 `{ ref: ... }`
- 读模型支持的表格消费者还可以设置 `selectionState: <name>`，以便将一个选中行暴露给精细的页面级交接操作
- 当前前端 `readModel rules` 消费仅支持：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- 当前前端 `readModel rules` 行为保持精细：
  - `eligibility` 和 `validate` 在本地门控获取，并在生成的页面上显示错误消息
  - `derive` 在获取后于客户端在获取的行上运行；它不是查询下推
  - `derive` 目前仅支持标量、非 `datetime` 结果字段
  - `allow/deny` 鉴权条目在此前端切片中被拒绝
- 精细交接示例：

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

- 当前列表列界面保持精细：
  - 仅限结果字段
  - 无关系 style 投影
  - 无 `@custom(...)`、`@fn(...)` 或 `@expr(...)`
- 分组表格消费者渲染来自 `list.groupBy:` 的分组摘要行，以及来自剩余列表列的嵌套报价行
- 透视分组矩阵消费者渲染来自 `list.groupBy:` 的分组摘要行，使用 `list.pivotBy:` 作为动态变体列，并在每个变体单元格内渲染剩余的列表列
- 当前表格消费者可以可选地添加精细的行交接操作：
  - 仅通过使用 `data: readModel.<name>.list` 的页面表格区块
  - 仅限 `rowActions.create`
  - 目标必须是生成的资源 `create:` 视图
  - `seed:` 可以引用 `row.<resultField>`、`input.<inputField>` 或标量字面量
  - `seed:` 仅可靶向已列在目标资源 `create.fields` 中的顶级标量、枚举或 `belongsTo(...)` 字段
  - 此切片用于将单行搜索/报价/结果交接到生成的创建开始，而非通用的行操作创作
- 当前页面还可以通过共享读模型选择添加一个精细的页面级创建交接：
  - 仅通过 `page.actions`
  - 仅限 `create:`
  - 仅当同一页面已具有带 `selectionState: <name>` 的 `data: readModel.<name>.list` 表格区块时
  - `create.seed` 可以引用 `selection: <selectionState>.<resultField>`、`input: <queryState>.<inputField>` 或标量字面量
  - `selection:` 必须引用现存的 `selectionState`
  - `input:` 必须引用现存的共享 `queryState`
  - 目标字段仍限于已列在目标资源 `create.fields` 中的顶级标量、枚举或 `belongsTo(...)` 字段
  - 此切片用于将双表或多表选定结果交接到生成的创建开始，而非通用的页面操作创作
- 不要围绕此切片虚构通用的查询/联接语法

---

## `page <name>:` 区块

仪表盘或包含布局区块的自定义页面。

```yaml
page dashboard:
  title: "System Overview"
  type: dashboard             # "dashboard" | "custom"
  layout: grid(2)             # grid(columns) 布局
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
      custom: "./components/RevenueChart.tsx"   # 逃生舱第 3 级
```

### 区块类型

| 类型 | 描述 |
|------|-------------|
| `metric` | 单个 KPI 数字；记录范围的关系页面还可以使用 `data: <resource>.<hasManyField>.count`，页面还可以通过 `data: readModel.<name>.count` 使用命名的读模型计数 |
| `chart` | 图表/图形可视化 |
| `table` | 内联数据表格；目前通过 `data: <resource>.list` 重用现存资源列表，或者通过 `data: readModel.<name>.list` 重用命名的读模型列表 |
| `custom` | **逃生舱第 3 级**：自定义区块组件 |

目前表格区块规则：

- `data:` 可以使用 `resourceName.list`，例如 `users.list`
- `data:` 也可以使用 `readModel.name.list`，例如 `readModel.flightAvailability.list`
- 命名的读模型表格重用要求引用的读模型定义了 `list:`
- 命名的读模型表格重用还可以设置 `queryState: <name>` 来与具有相同 `inputs:` 的其他读模型表格/计数消费者共享一个查询状态
- 命名的读模型表格重用还可以设置 `dateNavigation:`：
  - `field: <inputField>`
  - 可选的 `prevLabel`
  - 可选的 `nextLabel`
- 命名的读模型表格重用还可以设置 `selectionState: <name>` 来将一个选中行暴露给页面级创建交接
- 命名的读模型表格重用还可以通过 `rowActions:` 声明精细的交接操作：
  - 每个操作目前仅支持 `create:`
  - `create.resource` 必须引用一个具有 `create:` 的生成资源
  - `create.seed` 仅可引用 `row.<resultField>`、`input.<inputField>` 或标量字面量
  - `create.seed` 仅可靶向已列在目标 `create.fields` 中的顶级标量、枚举或 `belongsTo(...)` 字段
  - 生成的交接链接重用目标创建视图并传递清洗过的应用本地 `returnTo`
- 页面还可以通过 `actions:` 声明精细的共享选择交接操作：
  - 每个操作目前仅支持 `create:`
  - `create.resource` 必须引用一个具有 `create:` 的生成资源
  - `create.seed` 仅刻引用 `selection: <selectionState>.<resultField>`、`input: <queryState>.<inputField>` 或标量字面量
  - `selectionState` 必须来自该同一页面上现存的读模型支持的表格区块
  - `queryState` 必须来自该同一页面上现存的共享读模型查询状态组
  - 生成的页面级交接链接重用目标创建视图，在所有必需选择存在前禁用自身，并传递清洗过的应用本地 `returnTo`
- 记录范围的关系页面可以改用 `data: resourceName.hasManyField`，例如 `teams.members`
- 关系页面路由必须在页面上声明 `path: /<resource>/:id/...`
- 关系页面 `data: <resource>.<hasManyField>` 仅支持直接的 `hasMany(..., by: ...)` 字段
- 引用的目标资源必须存在
- 如果目标资源定义了带列的 `list:`，生成的页面表格重用该目标列表的列、关系派生过滤器、可排序关系列、分页和精细的查看/编辑/创建/删除操作
- 重用的页面区块查看/编辑/创建操作传递清洗过的应用本地 `returnTo`；在记录范围的关系页面上，创建还会将反向 `belongsTo(...)` 字段预填充到目标创建视图中
- 记录范围的关系页面本身在存在时使用清洗过的应用本地 `returnTo` 作为返回目标，否则退回到父资源读取路由或列表路由
- 记录范围的关系页面还在这些父路由存在时提供精细的父级查看/编辑标题操作，且现在在父资源已关联工作流时，在生成的标题中重用精细的父级工作流状态/链接；这些链接携带清洗过的应用本地 `returnTo`
- 如果目标资源没有 `list:` 界面，生成的页面表格退回到按目标标签字段键入的简单关联记录标签列表
- 目前页面范围参数仅支持这些记录范围的关系表格页面加上记录范围的关系计数指标区块；导航/重定向目标尚未绑定页面参数
- 同一个记录范围的关系页面上的自定义区块可以通过生成的 props 重用该路由上下文：`{ recordId, returnTo, backHref, parentReadHref, parentEditHref, parentRecord, parentLoading, parentError, parentWorkflow, relations }`，其中 `parentWorkflow` 是当父级关联了工作流时，父资源已关联的工作流清单的精细摘要，而 `relations` 仅总结该页面已声明的关系锚点，同时携带精细的标题/界面种类、项目标签/查看/编辑/工作流摘要加工作流状态标签，以及当这些现存锚点可用时重用 `createHref`

目前指标区块规则：

- 通用的指标/查询界面在现已落地的命名读模型计数和记录范围的关系计数消费者之外仍仅为占位符
- 记录范围的关系页面可以使用 `data: resourceName.hasManyField.count`，例如 `teams.members.count`
- 页面也可以使用 `data: readModel.name.count`，例如 `readModel.flightAvailability.count`
- `readModel.<name>.count` 重用与表格消费者相同的查询状态 `FilterBar`、必填输入门控和前端分组规则 `eligibility` / `validate` 检查，但仍保持为没有行操作或关系投影的仅限计数界面
- 命名的读模型计数重用还可以设置 `queryState: <name>` 来与具有相同 `inputs:` 的其他读模型表格/计数消费者共享一个查询状态
- 引用的读模型必须存在；它不需要定义 `list:`
- 关系页面路由必须在页面上声明 `path: /<resource>/:id/...`
- 关系页面 `data: <resource>.<hasManyField>.count` 仅支持直接的 `hasMany(..., by: ...)` 字段
- 引用的目标资源必须存在；它不需要定义 `list:`
- 生成的页面在存在时也使用清洗过的应用本地 `returnTo` 作为返回目标，否则退回到父资源读取路由或列表路由
- 当父资源定义了 `read:` 或 `edit:` 时，生成的页面标题重用这些父路由并附带清洗过的应用本地 `returnTo`

记录范围的关系页面示例：

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

## 表达式语言 (规则)

规则使用 **受限的表达式语言** — 而非 JavaScript。

### 支持的内容

```
# 比较
currentUser.role == "admin"
record.status != "suspended"
record.count > 10

# 逻辑运算符
hasRole(currentUser, "admin") && record.status == "active"
isOwner(currentUser, record) || hasRole(currentUser, "admin")
not isEmpty(record.name)

# 内置函数
hasRole(subject, "roleName")    # 检查角色
isOwner(subject, record)        # 检查所有权
isEmpty(field)                  # 检查是否为空
isNotEmpty(field)               # 检查是否不为空
count(collection)               # 统计项数
```

### 不支持的内容 (有意设计)

- 循环
- 变量赋值
- 任意函数调用
- 闭包或导入
- 内联 JavaScript

---

## 副作用语言 (onSuccess)

副作用是在成功操作后执行的一组有限的侧效应。

| 副作用 | 语法 | 描述 |
|--------|--------|-------------|
| `refresh` | `- refresh: resourceName` | 刷新/重新加载数据 |
| `invalidate` | `- invalidate: resourceName` | 使缓存失效 |
| `toast` | `- toast: "message"` 或描述符对象 | 显示通知 |
| `redirect` | `- redirect: users.list` | 导航到路由 |
| `openDialog` | `- openDialog: dialogName` | 打开模态框 |
| `emitEvent` | `- emitEvent: eventName` | 发送自定义事件 |

---

目前约束：

- `toast` 接受静态字符串或描述符对象
- 仅对固定文案使用静态字符串；如果插入了值或未来的国际化很重要，请立即优先使用描述符对象
- 不要映射变量到字符串消息内部
- 描述符 `values` 仅可包含标量字面量或 `{ ref: <path> }`
- 当前支持的 `ref` 根有：
  - `form.<field>`
  - 仅限编辑视图中的 `record.<field>`
  - `user.<field>`
  - 仅限编辑视图中的 `params.id`
- 未来的国际化支持应通过结构化描述符持续增长，而不是在前端家族源文件中内联模板语法

描述符形态的 `toast` 示例：

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

不支持的内容：

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

当外壳级视觉意图足够稳定，可以不使用原始 CSS 但又不属于 `.web.loj` 业务结构时，请使用 `.style.loj`。

当前连接点：

- `app.style: '@style("./styles/theme")'`
- `page.style`
- `page.blocks[].style`
- `resource.list.style`
- `resource.read.style`
- `resource.create.style`
- `resource.edit.style`
- `resource.workflow.style` 通过 `workflow: { source, style }` 连接

示例：

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
```

当前支持的 style 属性：

- 布局与定位：
  - `display: row | column | stack`
  - `gap`
  - `padding`
  - `paddingHorizontal`
  - `paddingVertical`
  - `alignItems: start | center | end | stretch`
  - `justifyContent: start | center | end | spaceBetween | spaceAround`
- 尺寸控制：
  - `width`
  - `minHeight`
  - `maxWidth`
- 表面材质：
  - `backgroundColor`
  - `borderRadius`
  - `borderWidth`
  - `borderColor`
  - `elevation`
- 字体排印与文本：
  - `typography`
  - `color`
  - `opacity`
- 继承：
  - `extends`
- 逃生舱：
  - `escape.css`

Token 引用规则：

- `gap`、`padding`、`paddingHorizontal`、`paddingVertical` 从 `spacing` 中解析
- `borderRadius` 从 `borderRadius` 中解析
- `elevation` 从 `elevation` 中解析
- `backgroundColor`、`borderColor`、`color` 从 `colors` 中解析
- `typography` 从 `typography` 中解析

样式护栏：

- 保持 `.style.loj` 用于“外壳级”样式意图
- 请勿尝试在这一层设定表格内部样式、表单分区细节、关系读取面板局部细节或复杂的响应式/移动端特定行为
- `escape.css` 是前端家族受限的逃生维度
- 只要出现必须与特定 DOM 深度耦合或强依赖特定 CSS 选择器结构的视觉需求，请使用原生 CSS 逃生或主机侧 CSS 组件，以保持共享 Style DSL 的通用性

样式逃生示例：

```yaml
style bookingListShell:
  extends: resultShell
  backgroundColor: surface
  elevation: panel
  escape:
    css: |
      background-image: linear-gradient(180deg, rgba(219, 232, 255, 0.35), rgba(255, 255, 255, 0.98));
```

---

## 逃生舱系统 (双轴)

当 DSL 无法表达某些内容时，请使用逃生舱。这里有 **两个独立的轴**：

### 逻辑逃生舱 (用于业务逻辑)

#### @expr(...) — 纯 TS 表达式 (最安全，首选)
用于内置表达式语言无法处理的内联逻辑。没有语句，没有导入，没有副作用。
```yaml
rules:
  visibleIf: '@expr(currentUser?.role === "admin" && record?.status !== "archived")'
```

当前的 `@expr(...)` 运行时上下文使用 `currentUser`、`record` 和 `formData`。

#### @fn(...) — 外部函数引用
用于对表达式来说太复杂但又不值得写一个完整组件的逻辑。引用一个导出一个函数的 `.ts` 文件。
```yaml
rules:
  allowIf: '@fn("./logic/canEditUser.ts")'
```

规则：
- 函数签名：`export default function name(context: { currentUser, record, formData }) { return boolean; }`
- 必须是同步的。
- 不能调用外部 API（否则就不是纯逻辑了）。

### UI 逃生舱 (用于自定义渲染)

#### 列上的 @custom(...) — 自定义单元格
```yaml
columns:
  - avatar @custom("./components/AvatarCell.tsx")
```
Props: `{ value, record }`

#### 字段上的 @custom(...) — 自定义字段
```yaml
fields:
  - avatar @custom("./components/AvatarUploader.tsx")
```
Props: `{ value, onChange }`

#### 区块上的 custom: — 自定义区块
```yaml
blocks:
  - type: custom
    title: "Revenue"
    custom: "./components/RevenueChart.tsx"
```

### ⚠️ 逃生预算
编译器跟踪逃生舱的使用情况。如果超过 **20%** 的节点使用逃生舱，系统将发出警告，提示 DSL 负载不当或需求超出范围。

---

## 完整示例

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

该文件的约 65 行代码能够生成 **8 个文件，约 370 行** 生产级 React/TypeScript 代码。
