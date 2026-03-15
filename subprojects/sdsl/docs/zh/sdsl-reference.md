# Lojban 范式 (后端家族 `.api.loj`) — LLM 参考文档

> **目的**：本文档是为当前的后端家族 MVP 切片生成有效的后端家族 `.api.loj` 文件的唯一事实来源。
> 当您需要一个精简的、目标中立的后端 DSL 时，请将此文档提供给 LLM。它目前可以编译为 Spring Boot + Java 或 FastAPI + Python。
>
> 如果您正在使用仓库本地的 AI Skill，请使用 [skills/loj-authoring/SKILL.md](../../../skills/loj-authoring/SKILL.md) 作为统一的工作流封装。
> 本文件保留为规范语法和契约参考。
>
> 旧版说明：`.sdsl` 在当前的 Beta 周期内仍是受支持的后端家族别名。
>
> 共享形态说明：当后端家族源文件或生成的产物重用仓库其他地方也存在的稳定编译器中立描述符形态时，规范的共享形式现在位于 [shared-compiler-contracts.md](../../../docs/shared-compiler-contracts.md) 中。后端家族应在合适的地方重用这些契约，而不是临时重新定义相同的描述符形态。

## Schema 版本: 0.1.0

---

## 配套工具集

当前针对此架构切片的配套命令：

- `sdsl validate <entry.api.loj|entry.sdsl>`
- `sdsl build <entry.api.loj|entry.sdsl> --out-dir <dir>`
- `sdsl dev <entry.api.loj|entry.sdsl> [--out-dir <dir>]`

仓库中的当前编辑器支持：

- 共享的 VSCode 扩展注册了 `.api.loj` 和旧版 `.sdsl`
- 已为后端家族源文件实现基于项目的诊断、悬停 (hover) 和审查 (inspect)
- 尚未为后端家族源文件实现生成源码追踪 (trace)

仓库原生后端示例：

- `subprojects/sdsl/examples/user-service/app.api.loj`
- `subprojects/sdsl/examples/user-service/app.fastapi.api.loj`
- `npm run mvn:test --workspace=@loj/example-user-service` 验证生成的 Spring Boot 项目，包括生成的 CRUD 端点测试
- `npm run py:compile:fastapi --workspace=@loj/example-user-service` 对生成的 FastAPI 项目进行语法烟雾测试
- `npm run py:test:fastapi --workspace=@loj/example-user-service` 将生成的 FastAPI 依赖安装到示例范围的虚拟环境中，并运行生成的 `pytest`

---

## 文件结构

后端家族源文件 (`.api.loj`，旧版 `.sdsl`) 是 **YAML 的严格子集**：

- 不支持锚点 (anchors)
- 不支持别名 (aliases)
- 不支持合并键 (merge keys)
- 不支持自定义标签 (custom tags)

后端家族 `.api.loj` 切片支持两种项目形态：

- **单文件应用**：一个根 `.api.loj` 文件，包含 `app:`、可选的 `compiler:` 以及语义定义
- **“根+模块”应用**：一个根 `.api.loj` 文件，包含可选的 `imports:` 以及语义模块文件，导入的模块可能还会导入其他模块

单文件应用就是一个没有 `imports:` 的根文件。

**根文件**中的顶级键：

| 键 | 必填 | 描述 |
|-----|----------|-------------|
| `app:` | 是 | 后端项目配置，如应用名称和 Java 基础包名 |
| `compiler:` | 否 | 代码生成配置；`v0.1` 支持 Spring Boot + Java + `mvc-jpa-security` 以及 FastAPI + Python + `rest-sqlalchemy-auth` |
| `imports:` | 否 | 仅限根文件的列表，包含额外的后端家族模块文件 |
| `model <Name>:` | 否 | 领域模型定义 |
| `resource <name>:` | 否 | 绑定到模型的 CRUD REST 资源 |
| `readModel <name>:` | 否 | 精简的命名 GET 读模型/搜索表面 |

**模块文件**中的顶级键：

| 键 | 允许 | 描述 |
|-----|---------|-------------|
| `model <Name>:` | 是 | 领域模型定义 |
| `resource <name>:` | 是 | CRUD 资源定义 |
| `readModel <name>:` | 是 | 精简的命名 GET 读模型/搜索表面 |
| `imports:` | 是 | 可选的传递性模块链接 |
| `app:` | 否 | 仅限根文件 |
| `compiler:` | 否 | 仅限根文件 |

目前的多文件支持有意保持精简：

- 导入必须是相对 `.api.loj` / `.sdsl` 文件路径，或以 `/` 结尾的相对目录
- 允许嵌套导入
- 导入循环是无效的，并通过导入链报告
- 导入的定义会合并到一个应用全局命名空间中
- 仍只有一个规范的入口文件，其中包含唯一的 `app:` 和 `compiler:` 区块
- 目录导入仅展开其直接子级后端家族源文件，按字典序排序

跨文件的重复模型、资源或读模型名称属于错误。

至少必须存在一个语义表面：

- `resource <name>:` 和/或 `readModel <name>:`
- `model <Name>:` 对于 `resource` 区块是必需的，而对于仅带有处理程序的读模型服务则是可选的

推荐默认方案：

- 小型演示和提示词规模的后端：单文件
- 大型服务定义：按领域使用 `imports:` 拆分

---

## `app:` 区块

仅将 `app:` 用于后端项目标识和包布局。

```yaml
app:
  name: "User Service"                  # 必填。人类可读的应用名称。
  package: "com.example.userservice"    # 必填。后端家族命名空间 / 包根目录。
```

规则：

- `name` 必填
- `package` 必填
- `package` 必须是有效的点号分隔的 Java 包名
- 不要在 `app:` 中放置认证提供商、数据库供应商覆盖或业务逻辑

`v0.1` 中生成的项目默认值取决于选中的后端目标平台/配置文件：

- Spring Boot + Java -> Maven + H2 本地配置
- FastAPI + Python -> `pyproject.toml` + SQLite 本地配置

---

## `compiler:` 区块

仅将此区块用于代码生成设置。

```yaml
compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security
```

Schema `0.1.0` 中的规则：

- 已实现且有效的目标三元组为：
  - `spring-boot / java / mvc-jpa-security`
  - `fastapi / python / rest-sqlalchemy-auth`
- `target`、`language` 和 `profile` 必须组成上述已实现的三元组之一

如果省略此区块，编译器的行为将如同选中了 `spring-boot / java / mvc-jpa-security`。

此区块的存在是为了让未来的架构版本可以添加：

- `language: kotlin`
- 备选的 Spring 配置文件
- 除 FastAPI 之外的其他后端目标平台

不要将 Java/Kotlin 编码进 `target`。

---

## `imports:` 区块

使用 `imports:` 进行显式的模块链接。

```yaml
imports:
  - ./models/user.api.loj
  - ./resources/users.api.loj
```

规则：

- 每个条目必须是相对 `.api.loj` / `.sdsl` 文件路径，或者是以后缀 `/` 结尾的相对目录路径
- 导入顺序不改变语义含义
- 导入的文件与根文件共享全局命名空间
- 模块文件可以包含它们自己的 `imports:`
- 导入循环是无效的
- 目录导入仅展开按字典序排序的直接子级后端家族源文件
- 目录导入不是递归的
- 根文件仍可以保留本地的 `model` 和 `resource` 定义

推荐拆分策略：

- `1-3` 个模型和 `1-2` 个资源：保留单个文件
- `4+` 个模型或 `3+` 个资源：按领域拆分

---

## `model <Name>:` 区块

定义一个领域模型，它将生成：

- 一个 JPA 实体
- 请求/响应 DTO
- 校验元数据

示例：

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, EDITOR, VIEWER)
  active: boolean
  createdAt: datetime @createdAt
```

生成的持久化标识是隐式的：

```yaml
id: long   # 自动生成。在 v0.1 中请勿手动声明。
```

### 字段类型

| 类型 | Java | 描述 |
|------|------|-------------|
| `string` | `String` | 文本字段 |
| `text` | `String` | 较长的文本字段 |
| `integer` | `Integer` | 整数 |
| `long` | `Long` | 长整数 |
| `decimal` | `BigDecimal` | 十进制数 |
| `boolean` | `Boolean` | 真假值 |
| `datetime` | `Instant` | 日期/时间 |
| `date` | `LocalDate` | 日历日期 |
| `enum(A, B, C)` | 生成的枚举 | 枚举值 |
| `belongsTo(Model)` | `Long` / 关联 ID | 到另一个模型的精细外键关系 |
| `hasMany(Model, by: field)` | 仅限元数据 | 派生的反向关系元数据；尚未生成列或 DTO 字段 |

### 字段装饰器

| 装饰器 | 描述 |
|-----------|-------------|
| `@required` | 字段必须存在 |
| `@email` | 必须是有效的邮件格式 |
| `@unique` | 生成唯一性约束 |
| `@minLen(n)` | 最小字符串长度 |
| `@maxLen(n)` | 最大字符串长度 |
| `@createdAt` | 生成的创建时间戳 |
| `@updatedAt` | 生成的更新时间戳 |

规则：

- `@email` 仅适用于 `string`
- `@minLen` 和 `@maxLen` 仅适用于 `string` 或 `text`
- `@createdAt` 和 `@updatedAt` 仅适用于 `datetime`
- `@unique` 是持久化层关注的项目，而不是跨资源的查询语言
- `belongsTo(Model)` 要求 `Model` 存在
- `hasMany(Model, by: field)` 要求 `Model` 存在，且 `by:` 指向目标模型上的一个 `belongsTo(CurrentModel)` 字段
- 当前后端家族切片将 `belongsTo(...)` 视为单个外键关系
- 生成的请求/响应 DTO 暴露关联记录 ID，而不是展开的嵌套对象
- `hasMany(...)` 仅作为反向元数据；它不创建存储、实体字段或请求/响应 DTO 字段
- `hasMany(...)` 反向字段不支持字段装饰器

目前非目标：

- 在声明的关系之上进行关系感知的投影
- 源码 DSL 中的自定义 SQL/JPA 注解
- 手动定义主键

---

## `readModel <name>:` 区块

定义一个精细的命名 GET 读模型/搜索表面。

示例：

```yaml
readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureAirport: string @required
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
```

精细 SQL 逃生示例：

```yaml
readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@sql("./queries/flightAvailability")'
```

### 必需键

| 键 | 必填 | 描述 |
|-----|----------|-------------|
| `api:` | 是 | 精确的 GET 路由路径 |
| `result:` | 是 | 行/结果形状 |
| `handler:` | 是 | 实现读模型的目标语言函数体片段 |
| `auth:` | 否 | 整表访问模式/角色 |
| `inputs:` | 否 | 查询输入；对于零输入读模型，请省略或保持为空 |
| `rules:` | 否 | 精细关联的 `.rules.loj` 资格/派生表面 |

规则：

- 当前读模型有意保持精细：
  - 仅限固定 `GET` 路由
  - 仅限列表结果
  - 仅限命名表面
  - 无自由形式的 join/查询构建器语法
- `api` 必须以 `/` 开头
- `auth:` 重用与 `resource auth` 相同的 `mode` / `roles` 形状
- 尚不支持 `readModel auth.policy`；在当前切片中，请将访问控制保留在 `mode` / `roles` 加上本地处理程序逻辑中
- `inputs:` 和 `result:` 使用与模型相同的字段创作形状，但目前读模型切片在那里仅支持标量字段类型
- 当前 `inputs:` 仅支持 `@required`
- 当前 `inputs:` 不支持 `datetime`；在此切片中使用 `date` 或 `string`
- 当前 `result:` 字段不支持装饰器
- `handler:` 必须使用 `@fn("./path")` 或 `@sql("./path")`
- 建议 `handler:` 使用无扩展名的逻辑 ID
- `@fn(...)` 的当前目标/语言解析：`spring-boot/java` 使用 `.java`，`fastapi/python` 使用 `.py`
- 接受显式的 `.java` / `.py` 后缀作为故意对特定处理程序的锁定
- `@sql(...)` 目前解析为 `.sql`
- `@sql(...)` 有意保持精细：
  - 仅限读模型处理程序
  - 仅限基于文件的查询；不要将大型 SQL 字符串内联到 `.api.loj` 中
  - 仅限只读 `SELECT` / `WITH` 查询
  - 在此切片中无存储过程、`CALL` 或写入导向的 SQL
  - 结果列应使用别名指向声明的 `result:` 字段名
- `rules:` 是可选的，必须使用 `@rules("./rules/x")`
- 建议 `rules:` 使用无扩展名的逻辑 ID
- `rules:` 目前仅支持：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- `rules:` 目前拒绝：
  - `allow/deny <operation>`
- `derive <field>` 必须靶向现有的 `result:` 字段
- `derive <field>` 目前仅支持除 `date` / `datetime` 之外的标量结果字段
- `readModel` 规则表达式目前允许：
  - `currentUser.id`、`currentUser.username`、`currentUser.role`、`currentUser.roles`
  - `input.<field>`
  - 派生内部的 `item.<resultField>`
  - 像 `ADMIN` 这样的裸大写标签
- Spring 生成类型化的控制器加处理程序适配器，并将 `PolicyPrincipal.fromAuthentication(authentication)` 传入处理程序
- Spring 读模型规则生成类型化的资格 + 验证 + 派生助手，并在处理程序输入/输出周围运行它们
- FastAPI 生成类型化的路由加处理程序适配器，并传入经认证的主体或 `None`
- FastAPI 读模型规则生成类型化的资格 + 验证 + 派生助手，并在处理程序输入/输出周围运行它们
- 处理程序片段保持为目标特定的逃生舱；不要将查询构建器、ORM 或框架词汇编码进 DSL 本身
- 在需要时，处理程序片段内部可以使用目标本地的 ORM 用法或原始 SQL，但它仍属于逃生舱代码而非后端家族语法
- 不要将原始 SQL 片段视为 CRUD/资源/读模型默认的创作路径；如果查询模式跨目标重复，请提取原语而不是将 SQL 规范化到核心 DSL 中

当前处理程序片段契约：

- 处理程序文件是一个目标语言函数体片段，而不是一个完整的控制器/服务/模块
- Spring 处理程序片段在 `List<ReadModelResult> execute(ReadModelInput input, PolicyPrincipal principal)` 内部执行
- FastAPI 处理程序片段在 `def execute(db: Session, input: ReadModelInput, principal: AuthenticatedUser | None) -> list[ReadModelResult]` 内部执行
- Spring 处理程序适配器还注入了 `EntityManager` 以及所有生成的存储库，以便本地特定目标的查询可以保留在逃生舱内部

目前非目标：

- 通用查询组合
- 查询下推 DSL
- 写入语义
- 每个操作的认证覆盖
- 读模型的远端前端家族消费
- 核心后端家族语法中的源码级 SQL 封装 DSL 或数据库供应商关键字

---

## `resource <name>:` 区块

将模型绑定到 REST API 表面并生成安全规则。

```yaml
resource users:
  model: User
  api: /api/users
  auth:
    mode: authenticated
    roles: [ADMIN]
  create:
    includes:
      - field: memberships
        fields: [role]
  operations:
    list: true
    get: true
    create: true
    update: true
    delete: true
```

### 必需键

| 键 | 必填 | 描述 |
|-----|----------|-------------|
| `model:` | 是 | 对模型名称的引用 |
| `api:` | 是 | 基础 REST 路径 |
| `auth:` | 否 | 此资源的安全性规则 |
| `workflow:` | 否 | 精细关联的 `.flow.loj` 生命周期表面 |
| `create:` | 否 | 精细的聚合根嵌套创建语义 |
| `update:` | 否 | 精细的聚合根单层嵌套更新/差分语义 |
| `operations:` | 否 | 要生成的 CRUD 端点 |

### `auth:` 区块

使用 `auth:` 描述精细策略意图，而不是 Spring 内部细节。

```yaml
auth:
  mode: authenticated   # "public" | "authenticated"
  roles: [ADMIN, SUPPORT]
  policy: '@fn("./policies/canManageUsers")'
```

规则：

- `mode` 默认为 `authenticated`
- 如果 `mode: public`，则必须省略 `roles`
- 如果 `mode: public`，则必须省略 `policy`
- `roles` 意味着“已认证用户必须具有这些角色之一”
- 角色名称应为大写标识符，不带 `ROLE_` 前缀
- `policy` 是可选的，并在内建的模式/角色检查之外额外运行
- `policy` 目前接受：
  - `@fn("./policies/canManageUsers")`
  - `@rules("./policies/order-access")`
- 建议两种形式都使用无扩展名的逻辑 ID
- `@fn(...)` 的当前目标/语言解析：`spring-boot/java` 使用 `.java`，`fastapi/python` 使用 `.py`
- 接受显式的 `.java` / `.py` 后缀作为故意对特定 `@fn(...)` 的锁定
- `@rules(...)` 接受无扩展名路径或显式的 `.rules.loj` 后缀

### `workflow:`

使用 `workflow:` 将一个精细的 `.flow.loj` 生命周期链接到一个资源。

```yaml
workflow: '@flow("./workflows/booking-lifecycle")'
```

规则：

- `workflow:` 是可选的，必须使用 `@flow("./workflows/x")`
- 建议使用无扩展名的逻辑 ID
- 显式的 `.flow.loj` 后缀被接受作为故意锁定
- 关联的工作流 `model` 必须与资源 `model` 匹配
- 关联的工作流 `field` 必须指向该模型的一个 `enum(...)` 字段
- 关联的工作流必须声明该字段的每个枚举值，并且每个声明的工作流状态必须存在于该枚举中
- Spring Boot 和 FastAPI 都会为此切片生成工作流感知的创建/更新包装器：
  - 创建时，如果 `wizard.steps[].completesWith` 存在，则从第一步种子化初始工作流状态，否则使用第一个声明的工作流状态
  - 更新时，保留当前工作流状态，而不是通过普通更新负荷接受直接的状态突变
  - 工作流关联的资源还会获得 `POST /.../{id}/transitions/{transition}` 以用于强制执行转换
- 在当前已实现的目标中，生成的后端工作流突变路径默认是事务性的：
  - Spring 将生成的工作流创建/更新/转换服务路径包装在 `@Transactional` 中
  - FastAPI 将生成的工作流创建/更新/转换服务路径包装在一个生成的 `Session` 提交/回滚边界内
- 创作者不需要在当前切片中为工作流关联的资源添加 `transactional: true`
- 转换 `allow` 表达式目前仅支持：
  - `currentUser.id`、`currentUser.username`、`currentUser.role`、`currentUser.roles`
  - `record.<field>`
  - 裸大写枚举类字面量，如 `READY` 或 `TICKETED`
- `wizard.steps` 仍创作在共享的工作流清单中；它们现在还可以设置可选的 `surface: form | read | workflow`，但后端路由生成仍仅直接消费转换表面

目前非目标：

- 项目外壳工作流业务编排
- 通用长事务 / saga 语法
- 源码 DSL 中的状态机库或事务框架词汇

### `create:` 区块

仅将 `create:` 用于精细的聚合根嵌套创建语义。

```yaml
create:
  rules: '@rules("./rules/booking-create")'
  includes:
    - field: passengers
      fields: [name, seat]
```

规则：

- 当前 `create:` 支持有意保持精细：
  - 仅限单层子集合
  - 仅限直接的 `hasMany(..., by: ...)` 关系
- `rules:` 是可选的，必须使用 `@rules("./rules/x")`
- 建议使用无扩展名的逻辑 ID
- `create.rules` 目前仅支持：
  - `eligibility <name>`
  - `validate <name>`
- `create.rules` 目前拒绝：
  - `allow/deny <operation>`
  - `derive <field>`
- `create.rules` 表达式目前允许：
  - `currentUser.id`、`currentUser.username`、`currentUser.role`、`currentUser.roles`
  - `payload.<field>`
  - `params.<name>`
  - 裸大写标签如 `ADMIN`
- `includes:` 条目必须引用资源模型上的直接 `hasMany(Target, by: field)` 模型字段
- `fields:` 条目必须命名关联目标模型上的字段
- 反向 `by:` 字段被自动种子化，不得再次列出
- 子级 `fields:` 目前可以使用标量、枚举或 `belongsTo(...)` 目标模型字段
- 子级 `fields:` 不得使用 `hasMany(...)`
- Spring 生成资源范围的嵌套创建 DTO 以及事务性子项持久化
- Spring `create.rules` 生成类型化的资格 + 验证助手，资格失败界面为 `403`，验证失败为 `400`
- FastAPI 生成资源范围的嵌套创建 schema 以及单次提交的子项持久化
- FastAPI `create.rules` 生成类型化的资格 + 验证助手，资格失败界面为 `403`，验证失败为 `400`
- 在当前已实现的目标中，生成的后端创建路径默认是事务性的：
  - Spring 将生成的创建服务路径包装在 `@Transactional` 中
  - FastAPI 将生成的创建服务路径包装在一个生成的 `Session` 提交/回滚边界内
- 创作者不需要在当前切片中为普通生成的创建路径添加 `transactional: true`

目前非目标：

- 更深的子项嵌套
- 源码 DSL 中的 ORM 特定级联词汇

### `update:` 区块

仅将 `update:` 用于精细的聚合根单层嵌套更新/差分语义。

```yaml
update:
  includes:
    - field: passengers
      fields: [name, seat]
```

规则：

- 当前 `update:` 支持有意保持精细：
  - 仅限单层子集合
  - 仅限直接的 `hasMany(..., by: ...)` 关系
  - `operations.update` 必须保持启用
- `includes:` 条目必须引用资源模型上的直接 `hasMany(Target, by: field)` 模型字段
- `fields:` 条目必须命名关联目标模型上的字段
- 反向 `by:` 字段被自动种子化，不得再次列出
- 子级 `fields:` 目前可以使用标量、枚举或 `belongsTo(...)` 目标模型字段
- 子级 `fields:` 不得使用 `hasMany(...)`
- 带有 `id` 的进入子项更新匹配已属于父记录的现有子项
- 不带 `id` 的进入子项在该父记录下创建新子项
- 从提交的集合中省略的现有子项将被删除
- Spring 生成资源范围的嵌套更新 DTO 以及事务性单层子项同步
- FastAPI 生成资源范围的嵌套更新 schema 以及单次提交单层子项同步
- 在当前已实现的目标中，生成的后端更新/删除路径默认是事务性的：
  - Spring 将生成的更新/删除服务路径包装在 `@Transactional` 中
  - FastAPI 将生成的更新/删除服务路径包装在一个生成的 `Session` 提交/回滚边界内
- 创作者不需要在当前切片中为普通生成的更新/删除路径添加 `transactional: true`

目前非目标：

- 更深的子项嵌套
- 除单层子项集合外的嵌套更新/差分
- 源码 DSL 中的 ORM 特定级联词汇

当前策略片段契约：

- 策略文件是目标语言函数体片段，而不是完整的控制器/服务文件
- 它必须返回一个布尔值
- 它可以访问：
  - `principal`
  - `operation`
  - `params`
  - `payload`

Spring 示例片段：

```java
return principal.hasRole("ADMIN") && !"delete".equals(operation);
```

FastAPI 示例片段：

```python
return "ADMIN" in principal.roles and operation != "delete"
```

当前关联规则契约：

```yaml
auth:
  mode: authenticated
  roles: [ADMIN, SALES]
  policy: '@rules("./policies/invoice-access")'
```

- 关联的 `.rules.loj` 文件编译为目标原生后端强制执行以及共享规则清单
- 当前后端关联规则上下文有意保持精细：
  - `currentUser.id` 和 `currentUser.username` 解析为已认证用户名
  - `currentUser.role` 解析为当前主要角色
  - `currentUser.roles` 解析为当前角色集合
  - `record.<field>` / `record.id`
  - `payload.<field>`
  - `params.<name>`
  - 像 `ADMIN` / `COMPLETED` 这样的裸大写标签被视为枚举类字面量
- 列表 `scopeWhen` / `scope` 目前编译为在控制器/路由层中生成的内存中过滤，而不是查询下推
- 关联规则仍仅限于资源级；每个操作的 `auth:` 覆盖仍不属于 `v0.1`

当前关联创建规则契约：

```yaml
create:
  rules: '@rules("./rules/booking-create")'
```

- 关联的 `.rules.loj` 文件编译为目标原生创建资格 + 验证助手
- 在此切片中仅消费 `eligibility <name>` 和 `validate <name>`
- `allow/deny` 和 `derive` 条目在此处是校验错误

当前关联读模型规则契约：

```yaml
readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    passengerCount: integer @required
  result:
    basePrice: decimal
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
  rules: '@rules("./rules/flight-availability")'
```

- 关联的 `.rules.loj` 文件编译为目标原生读模型资格 + 验证 + 派生助手
- 在此切片中仅消费 `eligibility <name>`、`validate <name>` 和 `derive <field>`
- `allow/deny` 条目在此处是校验错误

当前通用约束：

- `auth` 适用于整个资源
- 每个操作的认证覆盖不属于 `v0.1`
- 自定义后端逃生舱保持各自的事务边界：
  - 除了本地目标代码已有的部分外，编译器不会为 `@fn(...)` 额外生成事务包装器
  - `@sql(...)` 目前仅限读模型且为只读，因此它由于不参与生成的写入事务

### `operations:` 区块

控制生成哪些 CRUD 端点。

```yaml
operations:
  list: true
  get: true
  create: true
  update: true
  delete: true
```

默认值：

- 如果省略 `operations:`，五个操作均默认为 `true`

规则：

- `list` 生成 `GET /api/...`
- `get` 生成 `GET /api/.../{id}`
- `create` 生成 `POST /api/...`
- `update` 生成 `PUT /api/.../{id}`
- `delete` 生成 `DELETE /api/.../{id}`

如果操作为 `false`，则不生成该端点。

---

## 生成的 HTTP 契约

后端 DSL 必须与仓库级的传输契约对齐（位于 `docs/loj-transport-contract.md`）。

对于第一个生成的 Spring Boot 后端，推荐的规范封装格式为：

### 列表

```json
{
  "items": [
    { "id": 1, "name": "Ada", "email": "ada@example.com" }
  ]
}
```

### 单条记录

```json
{
  "item": { "id": 1, "name": "Ada", "email": "ada@example.com" }
}
```

### 错误

```json
{
  "message": "Validation failed"
}
```

规则：

- 所有返回的记录必须公开 `id`
- `id` 在后端传输中可以是数值；当前前端运行时可能会将其转换为字符串
- `DELETE` 可以返回 `204 No Content`
- 不要为 API 路由生成框架默认的 HTML 错误页面
- 当前后端家族源码不定义消息模板或描述符语法；保持 API 错误为稳定的、人类可读的 `message`

目前的重要约束：

- 在 `v0.1` 中**不**要求服务端驱动的分页元数据
- 不要要求第一个 SpringDSL 切片的 `total`、`page` 或 `pageSize`

如果以后需要更丰富的分页或错误/i18n 封装，必须先将其添加到共享的传输契约中。

---

## 校验语义

校验存在于两个层面：

- 编译时 DSL 校验
- 生成的 Spring 代码中的运行时校验

第一个 SpringDSL 切片应根据模型装饰器生成 Bean Validation 元数据。

示例：

```yaml
@required -> 非空 / 非空白校验
@email -> 电子邮件校验
@minLen(2) -> 最小尺寸校验
```

目前非目标：

- 跨资源校验规则
- 任意的校验表达式
- 从 DSL 直接引用自定义校验类

---

## `v0.1` 中不支持的功能

有意不支持的功能：

- 前端 `page` 区块
- 自定义查询 DSL
- 任意自定义控制器方法
- 除了精细的 `belongsTo(...)`、反向 `hasMany(..., by: ...)` 以及单层 `resource create.includes` / `resource update.includes` 之外的通用关系查询 DSL
- 方法级认证表达式
- 源码 DSL 中的 OAuth/JWT 提供商配置
- Kotlin
- Gradle
- WebFlux
- GraphQL
- 后台作业或消息传送
- OpenAPI 优先创作
- 项目外壳工作流业务编排或通用长事务语法

如果您需要其中之一，请不要发明临时语法。请先扩展契约。

---

## 完整示例

```yaml
app:
  name: "User Service"
  package: "com.example.userservice"

compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, EDITOR, VIEWER)
  active: boolean
  createdAt: datetime @createdAt

resource users:
  model: User
  api: /api/users
  auth:
    mode: authenticated
    roles: [ADMIN]
  operations:
    list: true
    get: true
    create: true
    update: true
    delete: true
```

此文件旨在生成可运行的 Spring Boot CRUD 后端，具有：

- JPA 实体 + 存储库
- 服务层
- REST 控制器
- Bean Validation
- Spring Security 角色门控
- 基于 H2 的本地示例配置

---
