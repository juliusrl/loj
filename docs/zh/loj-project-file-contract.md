# Loj 项目文件规范 (loj.project.yaml)

该文档定义了 `loj.project.yaml` 文件的架构与行为。该文件是 Loj 全栈方案的编排层（Orchestration Layer）。

## 核心定位

`loj.project.yaml` 负责：
- 定义应用包含哪些 **Target**（前端、后端等）。
- 指定每个 Target 的 DSL 源码入口（Entry Point）。
- 配置生成代码的输出目录（Output Directory）。
- 编排开发环境（Dev Host 与 Server 的运行）。
- 为生成的 Target 提供数据库与运行时（Runtime） Profile。

该文件 **不能** 包含业务语义（如 model、resource 等）；这些内容应放在 `.web.loj` 或 `.api.loj` 文件中。

---

## 最小配置示例

```yaml
app:
  name: user-admin

targets:
  frontend:
    type: web
    entry: frontend/app.web.loj
  backend:
    type: api
    entry: backend/app.api.loj
```

---

## 字段参考

### 顶级配置项

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `app` | **必填** | 应用的基础元数据。 |
| `targets` | **必填** | Target 别名及其配置的 Map。 |
| `dev` | 可选 | 开发阶段的编排设置（用于 `loj dev`）。 |

### `app` 节点

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `name` | **必填** | 应用的逻辑名称（如 `invoice-system`）。 |

### `targets` 节点

`targets` 下的每个 Key 是一个 **逻辑别名**（如 `frontend`, `backend`, `admin-api`）。

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `type` | **必填** | `web` (前端) 或 `api` (后端)。 |
| `entry` | **必填** | 相对于项目文件的 DSL 入口文件路径。 |
| `outDir` | 可选 | 生成代码的存放目录。如果不填，则使用默认约定。 |
| `database` | 可选 | 数据库配置（主要用于 `api` 类型的 target）。 |
| `runtime` | 可选 | 运行时环境配置（Base Path, CORS 等）。 |

#### `database` 配置详情

支持 `api` 类型 Target。

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `vendor` | **必填** | `h2`, `sqlite`, `postgres`, `mysql`, `mariadb`, `sqlserver`, `oracle`。 |
| `mode` | 可选 | `embedded` (嵌入式), `external` (外部), 或 `docker-compose`。 |
| `name` | 可选 | 数据库名称。默认为 `app.name` 派生。 |
| `host` | 可选 | 数据库主机。外部厂商默认为 `127.0.0.1`。 |
| `port` | 可选 | 数据库端口。 |
| `username` | 可选 | 数据库用户名。 |
| `password` | 可选 | 数据库密码。 |
| `autoProvision`| 可选 | 如果为 `true`，项目 Shell 在开发模式下可能会自动启动/配置数据库（如 Docker）。 |
| `migrations` | 可选 | `none`, `native-sql`, 或 `flyway`。 |

#### `runtime` 配置详情

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `basePath` | 可选 | 服务的基础 URL 路径（支持 `api` 和 `web` 类型）。 |
| `shutdown` | 可选 | 停机行为（仅 `api`）。包含 `mode` (`graceful`\|`immediate`) 和 `timeout`。 |
| `health` | 可选 | 健康检查端点路径（如 `/health`）。 |
| `readiness` | 可选 | 就绪检查端点路径（如 `/ready`）。 |
| `cors` | 可选 | CORS 配置（仅 `api`）。必须包含 `origins`。 |
| `forwardedHeaders` | 可选 | 转发头模式 (`standard`\|`none`)。 |
| `trustedProxy` | 可选 | 信任代理配置。 |
| `requestSizeLimit` | 可选 | 请求体大小限制（如 `10mb`）。 |

---

### `dev` 节点 (开发编排)

配置 `loj dev` 启动的托管式开发循环。

#### `dev.host` (前端代宿)

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `target` | **必填** | 引用一个 `web` 类型的 target 别名。 |
| `dir` | **必填** | 包含宿主项目（如 Vite/React 项目）的目录路径。 |
| `type` | 可选 | `react-vite` (默认)。 |
| `port` | 可选 | 开发服务器端口（默认 `5173`）。 |
| `apiBase` | 可选 | Proxy 前缀（默认 `/api`）。 |
| `proxyTarget`| 可选 | 代理目标 `api` 别名。 |

#### `dev.server` (后端服务)

| 字段 | 状态 | 描述 |
| --- | --- | --- |
| `target` | **必填** | 引用一个 `api` 类型的 target 别名。 |
| `port` | 可选 | 后端服务端口（默认 `3001`）。 |

---

## 环境变量 (Environment Variables)

项目 Shell 会按顺序自动加载以下环境变量文件（相对于项目文件）：
1.  `.env`
2.  `.env.local`
3.  `.env.<target-alias>`
4.  `.env.<target-alias>.local`

`.env.local` 会覆盖 `.env`。带有 target 别名的文件优先级更高。

---

## 核心准则

- **仅限编排 (Orchestration-only)**: 请勿在此处添加任何业务逻辑或规则。
- **约定优于配置 (Convention over Configuration)**: 只有在默认值不符合目标框架最佳实践时才进行显式覆盖。
- **相对路径**: `loj.project.yaml` 内的所有路径均相对于该文件所在目录。
