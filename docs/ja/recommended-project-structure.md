# 推奨されるプロジェクト構造

## ステータス

これは推奨事項であり、パーサーやコンパイラによる強制的な要件ではありません。

以下のデフォルトレイアウトとして使用してください：

- 新しい `loj.project.yaml` アプリ
- AI によって作成されたプロジェクト
- 将来のスキャフォールド（scaffold/init）のデフォルト

これが唯一の正当なリポジトリ形式であるとは考えないでください。

---

## 目的

リポジトリのカバー範囲が広くなったため、デフォルトのディレクトリ形状が役立ちます：

- AI による作成時のずれ（drift）を低減します。
- 関連する `@rules(...)`、`@flow(...)`、`@sql(...)`、`@style(...)`、および `@asset(...)` ファイルに予測可能な場所を提供します。
- `.web.loj`、`.api.loj`、`.rules.loj`、`.flow.loj`、`.style.loj`、およびホストのエスケープ（escape）ファイルを関心事ごとに分離して保持します。

このドキュメントは推奨されるレイアウトを定めるものであり、強制的なものではありません。

---

## 推奨されるデフォルト

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

意図：

- `frontend/` は Web ファミリのソース、スタイル、SEO アセット参照、およびフロントエンドのエスケープファイルをまとめます。
- `backend/` は API ファミリのソース、リードモデル（read-model）のハンドラー/クエリ、およびバックエンドのポリシー/ルール/ワークフローファイルをまとめます。
- `loj.project.yaml` はアプリのルートに配置します。

---

## フロントエンドのレイアウト

推奨設定：

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

これらのフォルダを役割ごとに使用してください：

- `models/` -> `model <Name>:`
- `resources/` -> `resource <name>:`
- `read-models/` -> `readModel <name>:`
- `pages/` -> `page <name>:`
- `rules/` -> リンクされた `.rules.loj`
- `workflows/` -> リンクされた `.flow.loj`
- `styles/` -> リンクされた `.style.loj`
- `components/` -> `@custom(...)` などのフロントエンドホストエスケープファイル
- `logic/` -> フロントエンドの `@fn(...)` ホストヘルパー
- `assets/` -> `@asset(...)` の画像/favicon/OG アセット

---

## バックエンドのレイアウト

推奨設定：

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

これらのフォルダを役割ごとに使用してください：

- `models/` -> `model <Name>:`
- `resources/` -> `resource <name>:`
- `read-models/` -> `readModel <name>:`
- `rules/` -> リンクされた `.rules.loj`
- `workflows/` -> リンクされた `.flow.loj`
- `handlers/` -> バックエンドの `@fn(...)` リードモデルハンドラー
- `policies/` -> バックエンドの `auth.policy: '@fn(...)'`
- `queries/` -> バックエンドのリードモデル `@sql(...)`

---

## `loj.project.yaml`

推奨されるルート配置：

```text
my-app/
  loj.project.yaml
```

推奨されるターゲットエントリ：

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

データベース/ランタイム/開発のオーケストレーションはこのファイルに保持し、`.web.loj` / `.api.loj` には記述しないでください。

---

## 推奨コマンド

通常のオーサリングおよび生成結果の確認作業には、プロジェクトシェル（Project-shell）コマンドを優先してください：

```bash
loj validate loj.project.yaml
loj build loj.project.yaml
loj dev loj.project.yaml
loj doctor loj.project.yaml
```

プロジェクトシェルのデータベース/ランタイムプロファイルは維持しつつ、片側だけを扱いたい場合は `--target <alias>` を使用してください：

```bash
loj build loj.project.yaml --target backend
loj dev loj.project.yaml --target frontend
```

`rdsl` / `sdsl` は引き続き有用ですが、現在は以下のためのセカンダリツールです：

- 純粋な単一ファミリの作業
- コンパイラ/デバッグ作業
- プロジェクトシェルのオーケストレーション外でのローカルな低レベル検証

これらは、新規ユーザーに示すデフォルトのエントリポイントであってはなりません。

---

## ガードレール

- このレイアウトは推奨事項であり、強制ではありません。
- フォルダ名をコンパイラのセマンティクスにハードコードしないでください。
- 将来のスキャフォールド/初期化コマンドはこの構造をデフォルトとすべきですが、オーサリングでは `entry` や相対的なリンクファイル参照を通じて代替パスを許可する必要があります。
