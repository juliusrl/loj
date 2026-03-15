# Loj

[English](README.md) | [简体中文](README.zh.md) | [日本語](README.ja.md)

**業務システム向けコード生成のためのAIネイティブな同系DSLファミリー。**

`0.5.0 (Logos)`

> [!NOTE]
> **公式サイト近日公開予定：** [loj.org](https://loj.org) を準備中です。インタラクティブなドキュメント、プレイグラウンド、コミュニティ事例を紹介する公式ポータルとなります。

## Quick Start

```bash
npm install -g @loj-lang/cli
loj --help
```

グローバルインストールなしの場合：

```bash
npx @loj-lang/cli --help
```

Lojは業務システムを対象にしたAIネイティブDSLファミリーです。目標は汎用のvibe-codedなページ生成ではなく、小さく安定したターゲット中立プリミティブで業務意図を表現し、それをフレームワークに最適なフロントエンド/バックエンドコードへコンパイルしつつ、追跡可能なescape hatchを残すことです。

現在、公開リポジトリは次の3点を証明しています：

- 1つのweb-family DSLから実際のReact/TypeScriptフロントエンドを生成できる
- 1つのapi-family DSLから同一ソースで2つのバックエンドターゲットを生成できる
- 1つのproject shellでそれらを検証・ビルド・起動し、フルスタックアプリとして扱える

現在実装済みのターゲット面：

- `.web.loj` フロントエンドfamilyソース -> `react/typescript`
- `.api.loj` バックエンドfamilyソース -> `spring-boot/java/mvc-jpa-security`
- `.api.loj` バックエンドfamilyソース -> `fastapi/python/rest-sqlalchemy-auth`
- `loj.project.yaml` -> マルチターゲットの validate/build/dev orchestration

現行ベータサイクルで維持しているレガシー別名：

- `.rdsl` -> `.web.loj` のフロントエンドfamily旧別名
- `.sdsl` -> `.api.loj` のバックエンドfamily旧別名

## なぜこれを作るのか

LLMは冗長な命令型フレームワークコードよりも、狭く宣言的でschema制約のある言語をうまく扱えます。Lojはその前提で設計されています：

- 可能な限りプリミティブを狭く、ターゲット中立に保つ
- フレームワーク差分を `target + language + profile` に押し下げる
- runtime、template、escape hatchをターゲット側の層として扱う
- ソースは高密度に、生成コードは展開し、ツールチェーンで追跡可能にする

そのため、同じ `.api.loj` 業務セマンティクスからSpring BootとFastAPIの両方を生成できます。

## 現在できること

- web family:
  - resources、pages、read-models、workflows、linked rules、grouped/pivot table consumer
  - `.style.loj` による shell-level style
  - app/page SEO metadata と asset refs
- api family:
  - models、resources、nested writes、read-models、workflows、linked rules
  - Spring Boot と FastAPI 生成
  - 読み取り専用 read-model 向けの狭い `@sql("./queries/x.sql")` escape
- project shell:
  - `loj validate`
  - `loj build`
  - `loj dev`
  - `loj rebuild`
  - `loj restart`
  - `loj status`
  - `loj doctor`
  - `loj stop`
  - `--target <alias>` による single-target project-shell flow
  - `loj.project.yaml` による database/runtime/dev orchestration

現在のリポジトリは、**業務システム向けの、公開デモ可能なフルスタックalpha**と表現するのが最も正確です。

## 公開評価パス

1本だけ評価パスを試すなら、まず flight-booking proof を推奨します：

```bash
npm install
npm run demo:loj:booking-proof:proof
```

このパスでは次が確認できます：

- shared-query検索フロー
- grouped result consumption
- workflow/wizard handoff
- nested aggregate writes
- linked rules
- 同一業務モデルからのSpring Boot / FastAPI生成

よりback-office寄りの縦型ショーケースを見たい場合は：

```bash
npm run demo:loj:invoice:proof
```

最小フルスタックbaselineだけ見たい場合は：

```bash
npm run demo:loj
```

booking proof あるいは user-admin baseline を FastAPI に切り替えたい場合は：

```bash
npm run demo:loj:booking-proof:fastapi
npm run demo:loj:fastapi
```

## クイックスタート

```bash
npm install

# 現在もっとも強い業務システム proof
npm run demo:loj:booking-proof:proof

# より強い back-office showcase
npm run demo:loj:invoice:proof

# 元の baseline
npm run demo:loj
```

さあ、**Loj it! 🚀**

repo 内の demo script ではなく、`loj.project.yaml` から直接扱いたい場合は：

```bash
loj validate examples/fullstack-flight-booking-proof/loj.project.yaml
loj build examples/fullstack-flight-booking-proof/loj.project.yaml
loj dev examples/fullstack-flight-booking-proof/loj.project.yaml
loj rebuild examples/fullstack-flight-booking-proof/loj.project.yaml --target frontend
loj restart examples/fullstack-flight-booking-proof/loj.project.yaml --service host

# single-target project-shell flow
loj build examples/fullstack-flight-booking-proof/loj.project.yaml --target backend
```

## 最小メンタルモデル

フロントエンドfamilyの記述：

```yaml
resource users:
  model: User
  api: /api/users
  list:
    columns: [name, role, status]
  edit:
    fields: [name, role, status]
```

バックエンドfamilyの記述：

```yaml
resource users:
  model: User
  api: /api/users
  operations: [list, get, create, update, delete]
```

重要なのは生成される構文そのものではなく、ソースを狭く安定に保ったまま、各ターゲットがフレームワークに最適なコードを出力できることです。

## CLI 詳細リファレンス

### プロジェクトコマンド (Project Commands)

これらのコマンドは通常、`loj.project.yaml` に対して作用し、複数のターゲットのビルドと実行をオーケストレートします。

- **`loj validate <project>`**: プロジェクト全体の DSL 定義、ターゲット設定、および環境変数を検証します。`--json` 出力をサポート。
- **`loj build <project>`**: プロジェクトで定義されたすべてのターゲットをビルドします。`--json` 出力をサポート。
- **`loj dev <project>`**: ファイルウォッチ、増分ビルド、およびマネージドサービスの実行を含む、高度な開発モードを開始します。
  - `--target <alias>`: 特定のターゲット（例：`backend`）のみに対して開発フローを開始します。
  - `--debug`: 詳細なデバッグログを有効にします。
  - `--json` 出力をサポート。
- **`loj rebuild <project>`**: 現在アクティブな `loj dev` セッション内で手動リビルドをキューします。
  - `--target <alias>`: 指定したターゲットだけを再ビルドします（たとえばスタイル調整中の `frontend`）。
  - `--json` 出力をサポート。
- **`loj restart <project>`**: 現在アクティブな `loj dev` セッション内でマネージドサービスを再起動します。
  - `--service <host|server|all>`: フロントエンド host、バックエンド server、または両方を再起動します。
  - `--json` 出力をサポート。
- **`loj status <project>`**: アクティブなサービスの状態、URL、ヘルスプローブ、およびデバッガエンドポイントを確認します。`--json` 出力をサポート。
- **`loj stop <project>`**: 現在アクティブなマネージド開発セッションを停止します。`--json` 出力をサポート。
- **`loj doctor <project>`**: 開発環境の深い診断を行い、依存関係の整合性や生成物のリンクを確認します。`--json` 出力をサポート。

### 個別コマンド (Individual Commands)

独立した DSL 資産の処理に使用します：

- **`loj rules validate/build <file.rules.loj>`**: 独立したルールファイルを検証またはビルドします。`--json` と `--out-dir` をサポート。
- **`loj flow validate/build <file.flow.loj>`**: 独立したワークフローファイルを検証またはビルドします。`--json` と `--out-dir` をサポート。

### Agent/Skill 管理

AI プログラミングアシスタント向けのドメインスキルパッケージを管理します：

- **`loj agent install <provider>`**: 内蔵スキルを指定された IDE にインストールします。
  - `<provider>`: `codex`, `windsurf`, または `generic`。
  - `--scope <user|project>`: ユーザーグローバルまたはプロジェクトローカルにインストールします。
- **`loj agent add <provider> --from <source>`**: ローカルパスまたはリモートからスキルを取得してインストールします。
- **`loj agent export <provider> --out-dir <dir>`**: 手動統合用に、内蔵スキルのアセットをエクスポートします。

## コマンド方針

通常利用では、上記の `loj` project-shell コマンドを優先してください。

`rdsl` と `sdsl` は引き続き存在しますが、現在は family-local な補助ツールです。compiler-focused な用途や単一 family 作業向けであり、公開上のデフォルト入口ではありません。

## リポジトリ構成

```text
subprojects/
  rdsl/   web-family のツールチェーン、ドキュメント、サンプル
  sdsl/   api-family のツールチェーン、ドキュメント、サンプル
packages/
  loj-cli/            project-level orchestration CLI
  loj-vscode/         repo-level VSCode拡張
  loj-benchmark-core/ benchmark harness
examples/
  fullstack-user-admin/            フルスタックbaseline
  fullstack-invoice-backoffice/    より強い back-office showcase
  fullstack-flight-booking-proof/  現在もっとも強い業務システムproofパス
docs/
  repo-level のノートと contract
```

## 次に読むもの

公開authoring surfaceは次から読むのがよいです：

- [skills/loj-authoring/SKILL.md](./skills/loj-authoring/SKILL.md) — AI向けの公開Loj authoring skill
- [loj-project-file-contract.md](./docs/ja/loj-project-file-contract.md) — `loj.project.yaml` 構成仕様
- [recommended-project-structure.md](./docs/ja/recommended-project-structure.md) — 推奨されるプロジェクト構造
- [env-project-story.md](./docs/ja/env-project-story.md) — 環境変数とプロジェクトのロード体系
- [rdsl-reference.md](./subprojects/rdsl/docs/ja/rdsl-reference.md) — フロントエンド核心構文リファレンス（`.web.loj`）
- [sdsl-reference.md](./subprojects/sdsl/docs/ja/sdsl-reference.md) — バックエンド核心構文リファレンス（`.api.loj`）

skill は公開AI向け入口であり、2つの reference が構文上の真実です。

## Skill のインストール

Codex系ワークフロー向けに公開 `loj-authoring` skill を入れる場合：

```bash
# user scope にインストール
npx @loj-lang/cli agent install codex

# Windsurf の既定 skills ディレクトリへインストール
npx @loj-lang/cli agent install windsurf

# プロジェクト内に vendored copy を置く
npx @loj-lang/cli agent install codex --scope project

# 任意ディレクトリへ export
npx @loj-lang/cli agent export codex --out-dir ./tooling/skills

# ローカルまたはリモートの skill bundle source から追加
npx @loj-lang/cli agent add codex --from ./tooling/skills/loj-authoring

# GitHub Release asset から直接インストール
npx @loj-lang/cli agent add codex --from https://github.com/juliusrl/loj/releases/download/v0.5.0/loj-authoring-0.5.0.tgz

# 任意の明示 skills ディレクトリへインストール
npx @loj-lang/cli agent install generic --skills-dir ~/.my-agent/skills
```

現在の直接取得パスはいずれも published CLI package 経由です：
- bundled install: `loj agent install ...`
- remote/local bundle install: `loj agent add ...`

## VSCode 拡張

現在の VSCode beta は VSIX release asset として配布しています：

- `loj-vscode-0.5.0.vsix`

GitHub Release ページから取得し、VSCode で次を実行してください：

- `Extensions: Install from VSIX...`

## ライセンス

Apache 2.0
