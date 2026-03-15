# Lojban パラダイム (フロントエンドファミリー `.web.loj`) — LLM リファレンスドキュメント

> **目的**: このドキュメントは、有効なフロントエンドファミリーの `.web.loj` ファイルを生成するための唯一の真実の情報源（Single Source of Truth）です。
> このドキュメントを LLM に与えることで、曖昧さのない指示という Lojban パラダイムに従い、一度の試行で正しいロジックと UI 構造を生成できるはずです。
>
> リポジトリ固有の AI Skill を使用している場合は、統合ワークフローラッパーとして [skills/loj-authoring/SKILL.md](../../../skills/loj-authoring/SKILL.md) を使用してください。
> このファイルは引き続き、標準の構文およびコントラクトのリファレンスとして機能します。
>
> レガシーに関する注記: 現在のベータサイクルの間、`.rdsl` は引き続きサポート対象のフロントエンドファミリーエイリアスです。
>
> 共有コントラクトに関する注記: フロントエンドファミリーの構文または生成されたインターフェースが、リポジトリ内の他の場所でも使用されている安定した記述子形式を再利用する場合、その標準形式は [shared-compiler-contracts.md](../../../docs/shared-compiler-contracts.md) に定義されています。現在のフロントエンドファミリーでの使用例には、共有メッセージ記述子、ハンドオフ/シード記述子、リードモデルページのコンシューマーバインディング、ワークフローのメタデータ/サマリー/マッピング別名、リレーションのサマリー、レコードスコープのカスタムブロックコンテキストが含まれます。`.web.loj` の編集時にこのパッケージを直接インポートすることはありません。この注記はコンパイラおよびランタイムの境界を規定するものです。

## スキーマバージョン: 0.1.0

---

## ファイル構造

フロントエンドファミリーのソースファイル (`.web.loj`、旧 `.rdsl`) は、**厳密な YAML サブセット**です（アンカー、エイリアス、マージキー、カスタムタグは使用できません）。

ReactDSL は 2 つのプロジェクト形式をサポートしています：

- **単一ファイルアプリ**: `app:`、オプションの `compiler:`、およびセマンティック定義を含む 1 つのルート `.web.loj` ファイル。
- **ルート・プラス・モジュールアプリ**: オプションの `imports:` を含む 1 つのルート `.web.loj` ファイルと、セマンティックなモジュールファイル。インポートされたモジュールは、さらに他のモジュールをインポートすることも可能です。

単一ファイルアプリは、`imports:` を持たないルートファイルに相当します。

**ルートファイル**のトップレベルキー：

| キー | 必須 | 説明 |
|-----|----------|-------------|
| `app:` | はい | アプリケーション設定: 名前、テーマ、認証、ナビゲーション |
| `compiler:` | いいえ | コード生成設定: 現在は `target: react` のみ |
| `imports:` | いいえ | ルートのみで使用可能な、追加のフロントエンドファミリーモジュールファイルのリスト |
| `model <Name>:` | はい (1つ以上) | フィールドとデコレータを含むデータモデル定義 |
| `resource <name>:` | はい (1つ以上) | モデルと API エンドポイントに紐付けられた CRUD リソース |
| `page <name>:` | いいえ | レイアウトブロックを含むダッシュボードまたはカスタムページ |

**モジュールファイル**のトップレベルキー：

| キー | 許可 | 説明 |
|-----|---------|-------------|
| `model <Name>:` | はい | データモデル定義 |
| `resource <name>:` | はい | CRUD リソース定義 |
| `page <name>:` | はい | ダッシュボード/カスタムページ定義 |
| `imports:` | はい | オプションの推移的なモジュールリンク |
| `app:` | いいえ | ルートのみ |
| `compiler:` | いいえ | ルートのみ |

現在のマルチファイルサポートは意図的に限定されています：

- インポートは、相対パスによる `.web.loj` / `.rdsl` ファイル、または `/` で終わる相対ディレクトリパスである必要があります。
- 入れ子になったインポートが可能です。
- インポートの循環は無効であり、インポートチェーンと共に報告されます。
- インポートされた定義は、アプリ全体の 1 つのネームスペースにマージされます。
- `app:` および `compiler:` ブロックを含めることができるのは、依然として 1 つの公式なエントリファイルのみです。
- ディレクトリインポートは、その直下のフロントエンドファミリーソースファイルのみを展開し、辞書順にソートされます。

ファイル間でのモデル/リソース/ページ名の重複はエラーとなります。

推奨されるデフォルト：

- 小規模なデモやプロンプトサイズのアプリ：単一ファイル
- 大規模な管理/ワークフローアプリ：`imports:` を使用してドメインごとに分割

---

## `app:` ブロック

```yaml
app:
  name: "My Admin"          # アプリのタイトル (文字列、必須)
  theme: dark                # "dark" | "light" (デフォルト: "light")
  auth: jwt                  # "jwt" | "session" | "none" (デフォルト: "none")
  navigation:                # サイドバーのナビゲーショングループ
    - group: "Section Name"
      visibleIf: <expr>      # オプション: 表示ルール
      items:
        - label: "Page Title"
          icon: dashboard     # アイコン名
          target: page.dashboard       # page.<name> または resource.<name>.list
```

---

## `compiler:` ブロック

このブロックはコード生成の設定にのみ使用してください。ビジネスロジック、ランタイム認証、API 情報などはここに記述しないでください。

```yaml
compiler:
  target: react   # オプション。デフォルト: react。v0.1 は "react" のみサポート。
```

`compiler:` ブロックは、DSL が将来的に `app:` を過負荷にすることなく複数のターゲットに成長できるように存在します。スキーマ `0.1.0` では、`react` 以外の値は無効です。
将来のスキーマバージョンでは、ターゲットファミリー、実装言語、プロファイルを分離する可能性がありますが、それらの追加キーはまだ `0.1.0` の一部ではありません。
Ant Design などの UI フレームワーク統合は、最終的には個別の DSL 方言としてではなく、`target: react` の上に付加的なプロファイル/ランタイムパッケージとして導入されるべきです。

---

## `imports:` ブロック

明示的なモジュールリンクには `imports:` を使用します。ルートファイルは、依然として `app:` および `compiler:` を含めることができる唯一のファイルです。

```yaml
imports:
  - ./models/user.web.loj
  - ./resources/users.web.loj
  - ./pages/dashboard.web.loj
```

ルール：

- 各エントリは、相対的な `.web.loj` / `.rdsl` ファイルパス、または `/` で終わる相対ディレクトリパスである必要があります。
- インポートの順序によってセマンティックな意味が変わることはありません。
- インポートされたファイルは、ルートファイルと同じグローバルネームスペースを共有します。
- モジュールファイルは独自の `imports:` を含めることができます。
- インポートの循環は無効です。
- ディレクトリインポートは、その直下のフロントエンドファミリーソースファイルのみを、パスの辞書順に展開します。
- ディレクトリインポートは再帰的ではありません。
- ルートファイルは、引き続きローカルに `model`、`resource`、`page` 定義を持つことができます。
- モジュールファイル内のエスケープハッチのパスは、ルートファイルからではなく、そのモジュールファイルからの相対パスとして解決されます。

推奨される分割の指針：

- モデルが `1-3` 個、リソースが `1-2` 個：1 つのファイルにまとめる
- モデルが `4` 個以上、またはリソースが `3` 個以上：ドメインごとに分割
- 複数のブロックを持つカスタムページ：そのページ専用のファイルを作成

---

## `model <Name>:` ブロック

データの形状を定義します。各フィールドには型とオプションのデコレータがあります。

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  status: enum(active, suspended)
  createdAt: datetime @auto
```

リソースに裏打ちされたレコードには、暗黙的なランタイムフィールドが含まれます：

```yaml
id: string   # ルーティング、編集、行アクションのために自動生成されます
```

ビューに明示的に表示したい場合を除き、`fields:` に `id` をリストする必要はありません。

### フィールド型

| 型 | TypeScript | 説明 |
|------|------------|-------------|
| `string` | `string` | テキストフィールド |
| `number` | `number` | 数値フィールド |
| `boolean` | `boolean` | 真偽値 |
| `datetime` | `string` (ISO) | 日付/時刻 |
| `enum(a, b, c)` | `'a' \| 'b' \| 'c'` | 列挙値 |
| `belongsTo(Model)` | `string \| number \| null` | 別のモデルへの外部 ID スタイルリレーション |
| `hasMany(Model, by: field)` | メタデータのみ | 派生した逆リレーションメタデータ。生成されたクライアントモデル型にはまだ出力されません |

### フィールドデコレータ

| デコレータ | 説明 |
|-----------|-------------|
| `@required` | フィールドが空であってはならない |
| `@email` | 有効なメール形式である必要がある |
| `@unique` | 値がユニークである必要がある |
| `@minLen(n)` | 最小文字列長 |
| `@auto` | 自動生成（例：タイムスタンプ） |

リレーションのルール：

- `belongsTo(Model)` は `Model` が存在することを要求します。
- `hasMany(Model, by: field)` は `Model` が存在し、`by:` がターゲットモデル上の `belongsTo(CurrentModel)` フィールドを指していることを要求します。
- 現在のフロントエンドファミリーのスライスでは、`belongsTo(...)` フィールドを、生成されたフォーム内の関連レコード ID として扱います。
- 関連リソースが存在する場合、生成された作成/編集ビューは `belongsTo(...)` フィールドを選択入力（Select Input）としてレンダリングします。
- 生成された作成ビューは、一致する `belongsTo(...)` フィールドを同名のクエリパラメータから事前入力し、アプリローカルの `returnTo` が存在する場合はそれをサニタイズしてキャンセルターゲットとして使用します。
- 生成された作成ビューに明示的なリダイレクト効果が宣言されていない場合、そのサニタイズされた `returnTo` がデフォルトの作成後リダイレクト先になります。
- 生成された編集ビューは、アプリローカルの `returnTo` が存在する場合はそれをサニタイズしてキャンセルターゲットとして使用します。
- 生成された編集ビューに明示的なリダイレクト効果が宣言されていない場合、そのサニタイズされた `returnTo` がデフォルトの編集後リダイレクト先になります。
- 生成された詳細表示ビューは、アプリローカルの `returnTo` が存在する場合はそれをサニタイズして戻り先ターゲットとして使用し、編集へのリンク時もそれを保持します。
- 関連リソースが存在する場合、生成された Web 列表、リストフィルター、およびソート可能な列では、`team.name` や `members.count` のような洗練されたリレーション派生プロジェクションを使用できます。
- 生成された `read:` ビューでも、`fields:` 内で同じ洗練されたリレーション派生プロジェクションを使用できます。
- 生成された `read.related:` は、`members` のような直接の `hasMany(..., by: ...)` フィールド名を受け入れます。
- 関連リソースが `list:` ビューを持っている場合、生成された `read.related:` パネルはそのターゲットリストの列、フィルター、ソート可能なリレーション列、ページネーション、および洗練された詳細/編集/作成/削除アクションを再利用します。それ以外の場合は、関連する詳細表示、次に編集、関連するワークフローがある場合は固定ワークフローページへとリンクするシンプルなタグリストにフォールバックし、ワークフローメタデータがある場合はターゲットのワークフロー状態ラベルを表示します。
- これらの再利用されたリレーションの詳細/編集/作成アクションは、サニタイズされたアプリローカルの `returnTo` を元のリレーションインターフェースに戻るように渡します。
- 再利用されたリレーション作成アクションは、逆の `belongsTo(...)` フィールドをターゲットの作成ビューに事前入力します。
- 生成されたレコードスコープのリレーションページは、ページのテーブルブロック内で `page.path: /<resource>/:id/...` と `data: <resource>.<hasManyField>` を使用することで、関連リソースが `list:` インターフェースを持っている場合にそれを再利用できます。持っていない場合はシンプルな関連レコードのタグリストにフォールバックします。
- 作成アクションを再利用するページテーブルブロックは、サニタイズされたアプリローカルの `returnTo` を渡します。レコードスコープのリレーションページテーブルブロックは、逆の `belongsTo(...)` フィールドも事前入力します。
- 生成されたレコードスコープのリレーションページでは、指標（Metric）ブロック内で `data: <resource>.<hasManyField>.count` を使用して、クエリ構文を有効にすることなく洗練された関連レコードカウントをレンダリングすることもできます。
- 生成されたレコードスコープのリレーションページ自体は、サニタイズされたアプリローカルの `returnTo` が存在すればそれを戻り先として使用し、そうでなければ親リソースの詳細ルートまたはリストルートにフォールバックします。
- 生成されたレコードスコープのリレーションページは、親ルートが存在する場合に洗練された親の詳細/編集ヘッダーアクションも提供します。これらのリンクはサニタイズされたアプリローカルの `returnTo` を運びます。
- `hasMany(...)` は逆行メタデータとしてのみ機能します。生成されたクライアントモデルフィールドとしては出力されず、生成されたリスト/フィルター/作成/編集/詳細フィールドのインターフェースで直接使用することはできません。
- `hasMany(...)` 逆フィールドはフィールドデコレータをサポートしません。

---

## `resource <name>:` ブロック

モデルを API に紐付け、CRUD ビューを定義します。

```yaml
resource users:
  model: User                # モデル名への参照
  api: /api/users            # API エンドポイント (文字列、必須)

  list:                      # 一覧/テーブルビュー
    title: "User Management"
    style: listShell
    filters: [email, role, team.name]   # フィルタリング可能なフィールド
    columns:                 # テーブルの列
      - name @sortable
      - email @sortable
      - team.name @sortable
      - members.count @sortable
      - role @tag(admin:red, editor:blue, viewer:gray)
      - status @badge(active:green, suspended:red)
      - createdAt @date
    actions:                 # 利用可能なアクション
      - create
      - view
      - edit
      - delete @confirm("Are you sure?")
    pagination: { size: 20, style: numbered }

  read:                      # 生成される詳細表示画面
    title: "User Details"
    style: detailShell
    fields:
      - name
      - team.name

  edit:                      # 編集フォームビュー
    style: formShell
    fields:
      - name
      - email @disabled
      - role @select
    rules:
      visibleIf: <expr>      # フォームを表示するかどうか
      enabledIf: <expr>      # フォームを有効にするかどうか
      allowIf: <expr>        # フォーム送信を許可するかどうか
      enforce: <expr>        # サーバーサイドでもチェックする必要があるルール
    onSuccess:
      - refresh: users
      - toast: "Saved!"

  create:                    # 作成フォームビュー
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

現在のリンクされた `.rules.loj` フォームルール：

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

現在の `workflow:` ルール：

```yaml
resource bookings:
  model: Booking
  api: /api/bookings
  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: workflowShell
```

- `workflow:` はオプションであり、スカラ値の `@flow("./workflows/x")` リンク、または `source:` とオプションの `style:` を含むマップのいずれかになります。
- `workflow:` には拡張子なしのロジック ID を推奨します。
- リンクされたワークフローの `model` はリソースの `model` と一致する必要があります。
- リンクされたワークフローの `field` は、そのモデル上の `enum(...)` フィールドを指す必要があります。
- リンクされたワークフローはそのフィールドの全ての列挙値を宣言する必要があり、宣言された各ワークフロー状態はその列挙型の中に存在しなければなりません。
- ワークフロー制御下にある列挙フィールドは、カスタムフィールドのエスケープハッチを意図的に使用しない限り、通常の生成された `create.fields` または `edit.fields` エントリとして現れることはありません。

現在のスタイルアタッチメントルール：

- `list.style`、`read.style`、`create.style`、および `edit.style` はオプションです。これらは関連付けられた `app.style` プログラム内の名前付きスタイルを参照する必要があります。
- `workflow:` がマップ形式を使用している場合、`workflow.style` も同じルールに従います。
- 第一波のスタイルフックは、それぞれのインターフェースの生成されたルートシェルにのみアタッチされます。独立した `table`、`form section`、または `read.related` スタイルフックはまだ提供されていません。

現在の `create.includes` / `edit.includes` ルール：

- `includes:` は生成された `create:` および生成された `edit:` の両方でオプションです。
- 各エントリは、リソースモデル上の直接の `hasMany(Target, by: field)` リレーションを参照する必要があります。
- 各エントリはオプションで `minItems: <非負整数>` を設定でき、生成されたフォーム内で空のサブ行を事前入力できます。
- 子の `fields:` は、リンクされたターゲットモデルに属している必要があります。
- 逆の `by:` フィールドは自動的に事前入力されるため、再度リストしてはいけません。
- 子の `fields:` は、現在、子モデル上のスカラ、列挙、または `belongsTo(...)` フィールドを使用できます。
- 子の `fields:` では `hasMany(...)` を使用できません。
- `edit.fields`、`create.fields`、`create.includes[].fields`、および `edit.includes[].fields` は、`field:` を持つオブジェクトエントリと、洗練されたフィールドレベルの `rules.visibleIf` / `rules.enabledIf` を使用できます。
- フィールドレベルのルールは、同じ共有式言語を再利用します：
  - 作成/編集のルートフィールドは、`currentUser`、`formData`、および編集時には `record` を参照できます。
  - 繰り返される子フィールドは、`currentUser`、`formData`、`item`、および編集時には `record` を参照できます。
- 現在のスライスでは、生成された作成/編集フォーム内で繰り返される子セクションを、生成された追加/削除コントロールおよび `minItems` による下限の強制と共にレンダリングします。
- `create.includes[].rules` および `edit.includes[].rules` も `rules: '@rules("./rules/x")'` を使用できます。
- 生成された `edit.includes` は、リンクされたターゲットリソースを介して既存の子行を読み込み、1 レベルの差分ペイロードを送信します：
  - `id` を持つ子行の更新
  - `id` を持たない子行の作成
  - 省略された既存の子行の削除
- 現在のスライスでは、さらに深い子のネストや任意の入れ子状の変異構文はまだサポートしていません。

現在のリンクされたフォームルールの挙動：

- `edit.rules` および `create.rules` は、依然として `visibleIf` / `enabledIf` / `allowIf` / `enforce` を含むインラインマップを使用できます。
- また、`rules: '@rules("./rules/x")'` を使用することもできます。
- 現在のフロントエンドでのリンクされたフォームルールの利用では、以下のみをサポートしています：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- リンクされた `allow/deny` エントリは、生成された作成/編集インターフェースでは拒否されます。
- リンクされた `eligibility` は生成されたインターフェースをローカルにゲートし、フォームをレンダリングする代わりに生成されたエラーインターフェースを表示します。
- リンクされた `validate` は送信前にローカルで実行され、生成されたバリデーションメッセージを表示します。
- リンクされた `derive` は現在、`create.fields` / `edit.fields` にリストされているトップレベルのスカラ生成フォームフィールドのみをサポートします。
- リンクされた派生ターゲットは、現在のスライスでは生成された読み取り専用フィールドとしてレンダリングされます。
- リンクされた作成ルールは `currentUser` および `formData` を参照できます。
- リンクされた編集ルールは `currentUser`、`formData`、および `record` を参照できます。
- リンクされた繰り返される子構成ルールは以下を参照できます：
  - `create.includes[].rules` では `currentUser`、`formData`、`item`
  - `edit.includes[].rules` では `currentUser`、`formData`、`item`、`record`
- リンクされた繰り返される子構成ルールでは、以下のみをサポートしています：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- リンクされた繰り返される子の `derive` は、現在、その `includes` の `fields:` にリストされているスカラ生成子フィールドのみをサポートします。
- リンクされたフォームコンシューマーでは、命令的なイベントハンドリング構文はまだ有効になっていません。

### 列デコレータ

| デコレータ | 説明 |
|-----------|-------------|
| `@sortable` | 列がソート可能 |
| `@date` | 日付としてフォーマット |
| `@tag(key:color, ...)` | 色付きのタグとしてレンダリング |
| `@badge(key:color, ...)` | ステータスバッジとしてレンダリング |
| `@custom("./path.tsx")` | **エスケープハッチティア 1**: カスタムセルレンダラー |

### フィールドデコレータ (edit/create 内)

| デコレータ | 説明 |
|-----------|-------------|
| `@select` | ドロップダウン選択としてレンダリング |
| `@disabled` | フィールドが読み取り専用 |
| `@custom("./path.tsx")` | **エスケープハッチティア 2**: カスタムフィールドコンポーネント |

`read.fields:` は、`@sortable` を除き、リスト列の表示デコレータを再利用します。

### アクション

| アクション | 説明 |
|--------|-------------|
| `create` | 「作成」ボタンを表示 |
| `view` | リソースが `read:` ビューを持っている場合、各行に「詳細」アクションを表示 |
| `edit` | 各行に「編集」アクションを表示 |
| `delete` | 各行に「削除」アクションを表示 |
| `delete @confirm("msg")` | 確認ダイアログ付きの削除 |

関連パネルの例：

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

関連リソースも `list:` を定義している場合、生成されたパネルはそのターゲットリストの列、フィルター、ソート可能なリレーション列、ページネーション、および洗練された詳細/編集/作成/削除アクションを再利用します。
その再利用されたアクションインターフェースに詳細、編集、または作成が含まれる場合、生成されたリンクは、ターゲットの詳細/編集/作成インターフェースがパネルまたは関連ページに戻れるよう、サニタイズされたアプリローカルの `returnTo` を追加します。再利用されたリレーション作成は、逆の `belongsTo(...)` フィールドをターゲットの作成ビューに事前入力します。生成された作成/編集ビューに明示的なリダイレクト効果がない場合、同じ `returnTo` がデフォルトの送信後リダイレクト先になります。
生成されたアプリは、各 `read.related` エントリに対して `/:id/related/<field>` にレコードスコープの関連コレクションルートも追加します。

ワークフローに関連付けられたリソースは、生成された作成/編集/詳細表示インターフェースにおいて、リンクされた `.flow.loj` マニフェストも再利用します：

- 作成ビューでは、初期のワークフロー状態と可視の作業ウィザードステップを表示します。
- `wizard.steps` は、オプションとして `surface: form | read | workflow` を設定できるようになりました。省略された場合、最初のステップはデフォルトで `form` になり、以降のステップはデフォルトで `workflow` になります。
- 作成ビューは、これらの可視の作業ウィザードステップから洗練された現在/次のステップのサマリーを派生させ、可視の次のステップがある場合にメインの送信ボタンを `作成して <次のステップ> を続行` にアップグレードし、明示的なリダイレクト効果やアプリローカルの `returnTo` が存在しない場合、成功した送信後はデフォルトで次のステップで宣言されたインターフェース（`form` -> 生成された編集、`read` -> 生成された詳細、`workflow` -> 固定ワークフローページ）へと進み、固定ワークフローページをフォールバックとします。
- 編集ビューでは、現在のワークフロー状態と可視の作業ウィザードステップを表示し、同じ洗練された現在/次のステップのサマリーを派生させ、可視の次のステップがある場合にメインの送信ボタンを `保存して <次のステップ> を続行` にアップグレードし、固定ワークフローページへの洗練された `ワークフロー` リンクを提供します。また、明示的なリダイレクト効果やアプリローカルの `returnTo` が存在しない場合、成功した送信後はデフォルトで同じ次のステップのインターフェース解決へと進みます。
- 詳細表示ビューでは、現在のワークフロー状態、可視の作業ウィザードステップ、洗練された現在/次のステップのサマリー、後のレビューステップが要求された場合の洗練された生成済みの `workflowStep` ハンドオフ、および前の可視ステップがある場合の洗練された `前のステップを再開` リンクを表示します。これは、ウィザードの次の可視ステップに進むための遷移を優先的に処理し、その後 `/api/.../{id}/transitions/{transition}` にポストされる他の許可された遷移アクションをレンダリングします。遷移が成功した後、生成されたインターフェースはインターフェースの変化があった際も次の可視のウィザードステップで宣言されたインターフェースへとリダイレクトするようになりました。
- 生成されたリスト/詳細/テーブルのレンダリングでも、素の列挙値だけでなく、ワークフロー制御下の列挙フィールドにはワークフロー状態ラベルを再利用します。
- リソースに裏打ちされたテーブルコンシューマーは、固定ワークフローページにリンクするサニタイズされたアプリローカルの `returnTo` を運ぶ洗練された `ワークフロー` 行アクションも提供するようになりました。
- 生成されたルートでは、`/:id/workflow` に固定のリソースワークフローページも追加されます。これは、現在の状態サマリー、洗練された現在/次のステップのサマリー、ウィザードステップの進行、次のステップ優先の遷移アクション、洗練された `workflowStep` レビューハンドオフ、`前のステップを再開` ナビゲーション、遷移後の次のステップのインターフェースハンドオフのために、同じワークフロー関連付けマニフェストを再利用します。また、詳細表示ビューが存在する場合は既存の `read.related` アンカーから派生した洗練された関連インターフェースサマリー、詳細表示ビューが存在する場合は生成された `read.fields` レコードコンテキスト詳細と生成された `read.related` パネルコンテキスト、リンクされたターゲットに生成済みの詳細/編集インターフェースがない場合はワークフロー状態ラベルを伴うシンプルなタグリストによるフォールバックリンク、およびサニタイズされたアプリローカルの `returnTo` を伴う洗練された `詳細` / `編集` / `戻る` リンクも提供します。

現在のワークフローの制約：

- 現在、ワークフローの関連付けはリソースレベルに限定されています。ワークフローページルートはその関連付けから生成されるものであり、個別にオーサリングされるものではありません。そのため、`.web.loj` 内でカスタムのページレベルのウィザードルート、プロジェクトシェルのワークフローターゲット、またはルーター/ステートマシンライブラリの語彙を捏造しないでください。

---

## `readModel <name>:` ブロック

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

現在の `readModel` ルール：

- `readModel <name>:` は `.web.loj` におけるトップレベルブロックです。
- `api:` は必須であり、固定の GET エンドポイントを指す必要があります。
- `rules:` はオプションです。`@rules("./rules/x")` を使用しなければなりません。
- `inputs:` および `result:` は、フィールドリストではなく、YAML マップである必要があります。
- `inputs:` および `result:` 内部では、現在、スカラおよび列挙フィールド型のみをサポートしています。
- `list:` は、`data: readModel.<name>.list` を介してこれを使用する場合にのみ必須です。指標（Metric）コンシューマーを `data: readModel.<name>.count` を介して使用する場合、これは不要です。
- 現在のフロントエンドファミリーのコンシューマーは、`data: readModel.<name>.list` を持つページテーブルブロックと、`data: readModel.<name>.count` を持つページ指標ブロックです。
- これらの生成されたページインターフェースは、`inputs:` からのクエリ状態 `FilterBar` 入力、URL に連動したリードモデルスコープのクエリ状態、および初回フェッチ前の必須入力のゲート処理を使用します。テーブルコンシューマーはフェッチされた行に対してローカルのソート/ページネーションを追加しますが、指標コンシューマーはカウントのみに留まります。
- リードモデルページのコンシューマーは `queryState: <name>` も設定でき、同じ `inputs:` を持つ複数のリードモデルコンシューマー間で単一の URL 連動クエリ状態を共有できます。
- 複数のリードモデルコンシューマーが同じ `queryState` を共有している場合、生成されたページはそのグループ内の最初のテーブルコンシューマー、またはテーブルコンシューマーがない場合は最初の指標において、共有の `FilterBar` / ゲートインターフェースをレンダリングします。
- `list.groupBy:` はオプションであり、現在は `data: readModel.<name>.list` テーブルコンシューマーに対してのみ機能します。
- `list.groupBy:` は、`list.columns`内にも現れる結果フィールド名を含む必要があります。
- 現在のスライスでは、`list.groupBy:` フィールドでリレーションスタイルプロジェクションを使用することはできず、`@sortable` とマークすることもできません。
- グループ化されたテーブルコンシューマーは、少なくとも 1 つの非グループ化見積り（Quote）列を依然として保持する必要があります。
- `list.pivotBy:` はオプションであり、現在はグループ化された `data: readModel.<name>.list` テーブルコンシューマーに対してのみ機能します。
- `list.pivotBy:` は、`list.columns`内にも現れる結果フィールドを参照する必要があります。
- `list.pivotBy:` ではリレーションスタイルプロジェクションを使用できず、`@sortable` とマークすることもできません。
- ピボットされたグループ化マトリックスコンシューマーは、少なくとも 1 つの非グループ化、非ピボット見積り列を依然として保持する必要があります。
- ピボットされたグループ化マトリックスコンシューマーは、現在、全ての `@sortable` 列を拒否します。
- グループ化されたリードモデルテーブルコンシューマーは、グループ化された結果を表示するための洗練されたフロントエンドプレゼンテーションの再利用です。バックエンドのクエリ構文を追加するものではありません。
- ピボットされたグループ化マトリックスコンシューマーは、同じ種類の洗練されたフロントエンドプレゼンテーションの再利用です。これらはフェッチされたグループ化された行をバリエーション（Variant）列としてピボットするものであり、バックエンドのクエリ構文を拡張するものではありません。
- リードモデルに裏打ちされたテーブルコンシューマーは `dateNavigation:` も設定でき、`field: <inputField>` とオプションの `prevLabel` / `nextLabel` を含みます。これは現在のクエリ状態内のみで既存の文字列/日付形式のリードモデル入力を切り替えるものであり、バックエンドのクエリ構文を拡張するものではありません。
- 現在のスライスでは、リソースの `list.title` / `read.title`、ナビゲーションの `group` / アイテムの `label`、`page.title`、`block.title`、ページ/作成ハンドオフの `label`、およびリードモデルの `dateNavigation.prevLabel` / `nextLabel` 上のユーザー向けフロントエンドファミリーコピーは、プレーンな文字列、または共有記述子形式 `{ key?, defaultMessage?, values? }` を受け入れます。
- この UI コピー記述子のスライスは、意図的に洗練された状態に保たれています：
  - 固定のコピーにはプレーンな文字列を使用してください。
  - 将来の i18n やリテラルの挿入が重要な場合は、記述子を使用してください。
  - これらの UI コピーフィールド内の記述子 `values` は、現在スカラリテラルのみを受け入れ、`{ ref: ... }` は受け入れません。
- リードモデルに裏打ちされたテーブルコンシューマーは `selectionState: <name>` も設定でき、洗練されたページレベルのハンドオフアクションに単一の選択行を露出させます。
- 現在のフロントエンドでの `readModel rules` の利用では、以下のみをサポートしています：
  - `eligibility <name>`
  - `validate <name>`
  - `derive <field>`
- 現在のフロントエンドでの `readModel rules` の挙動は洗練された状態に保たれています：
  - `eligibility` および `validate` はローカルにフェッチをゲートし、生成されたページにエラーメッセージを表示します。
  - `derive` はフェッチ後にクライアントサイドでフェッチされた行に対して実行されます。クエリ下推（Query Pushdown）ではありません。
  - `derive` は現在、スカラで非 `datetime` の結果フィールドのみをサポートしています。
  - `allow/deny` 認証エントリは、このフロントエンドスライスでは拒否されます。
- 洗練されたハンドオフの例：

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

- 現在のリスト列インターフェースは洗練された状態に保たれています：
  - 結果フィールドのみ。
  - リレーションスタイルプロジェクションなし。
  - `@custom(...)`、`@fn(...)`、または `@expr(...)` なし。
- グループ化されたテーブルコンシューマーは、`list.groupBy:` からのグループサマリ行と、残りのリスト列からの入れ子状の見積り行をレンダリングします。
- ピボットされたグループ化マトリックスコンシューマーは、`list.groupBy:` からのグループサマリ行をレンダリングし、`list.pivotBy:` を動的なバリエーション列として使用し、各バリエーションセル内に残りのリスト列をレンダリングします。
- 現在のテーブルコンシューマーは、洗練された行ハンドオフアクション（rowActions）をオプションで追加できます：
  - `data: readModel.<name>.list` を使用するページテーブルブロックを介する場合のみ。
  - `rowActions.create` のみ。
  - ターゲットは生成されたリソースの `create:` ビューである必要があります。
  - `seed:` は `row.<resultField>`、`input.<inputField>`、またはスカラリテラルを参照できます。
  - `seed:` は、ターゲットリソースの `create.fields` 内ですでにリストされているトップレベルのスカラ、列挙、または `belongsTo(...)` フィールドのみを対象にできます。
  - このスライスは、単一行の検索/見積り/結果を生成された作成開始へとハンドオフするためのものであり、汎用的な行アクションオーサリング用ではありません。
- 現在のページでは、共有されたリードモデル選択を介して、洗練されたページレベルの作成ハンドオフを追加することもできます：
  - `page.actions` を介する場合のみ。
  - `create:` のみ。
  - 同じページに `selectionState: <name>` を持つ `data: readModel.<name>.list` テーブルブロックがすでにある場合のみ。
  - `create.seed` は `selection: <selectionState>.<resultField>`、`input: <queryState>.<inputField>`、またはスカラリテラルを参照できます。
  - `selection:` は既存の `selectionState` を参照する必要があります。
  - `input:` は既存の共有 `queryState` を参照する必要があります。
  - ターゲットフィールドは依然として、ターゲットリソースの `create.fields` 内ですでにリストされているトップレベルのスカラ、列挙、または `belongsTo(...)` フィールドに限定されます。
  - このスライスは、2つまたは3つのテーブルからの選択された結果の組み合わせを生成された作成開始へとハンドオフするためのものであり、汎用的なページアクションオーサリング用ではありません。
- このスライス周辺で汎用的なクエリ/結合（Join）構文を捏造しないでください。

---

## `page <name>:` ブロック

レイアウトブロックを用いたダッシュボードまたはカスタムページ。

```yaml
page dashboard:
  title: "System Overview"
  type: dashboard             # "dashboard" | "custom"
  layout: grid(2)             # grid(columns) レイアウト
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
      custom: "./components/RevenueChart.tsx"   # エスケープハッチティア 3
```

### ブロック型

| 型 | 説明 |
|------|-------------|
| `metric` | 単一の KPI 数値。レコードスコープのリレーションページでは `data: <resource>.<hasManyField>.count` も使用でき、ページでは `data: readModel.<name>.count` を介して名前付きリードモデルカウントも使用できます |
| `chart` | チャート/グラフによる可視化 |
| `table` | インラインデータテーブル。現在は `data: <resource>.list` を介して既存のリソースリストを、または `data: readModel.<name>.list` を介して名前付きリードモデルリストを再利用します |
| `custom` | **エスケープハッチティア 3**: カスタムブロックコンポーネント |

現在のテーブルブロックルール：

- `data:` では `resourceName.list` （例：`users.list`）を使用できます。
- `data:` では `readModel.name.list` （例：`readModel.flightAvailability.list`）も使用できます。
- 名前付きリードモデルテーブルの再利用には、参照先のリードモデルが `list:` を定義していることが必要です。
- 名前付きリードモデルテーブルの再利用では `queryState: <name>` も設定でき、同じ `inputs:` を持つ他のリードモデルテーブル/カウントコンシューマーとクエリ状態を共有できます。
- 名前付きリードモデルテーブルの再利用では `dateNavigation:` も設定できます：
  - `field: <inputField>`
  - オプションの `prevLabel`
  - オプションの `nextLabel`
- 名前付きリードモデルテーブルの再利用では `selectionState: <name>` も設定でき、選択された行をページレベルの作成ハンドオフに露出させます。
- 名前付きリードモデルテーブルの再利用では、`rowActions:` を介して洗練されたハンドオフアクションを宣言することもできます：
  - 各アクションは現在、`create:` のみをサポートしています。
  - `create.resource` は、`create:` を持つ生成されたリソースを参照する必要があります。
  - `create.seed` は `row.<resultField>`、`input.<inputField>`、またはスカラリテラルのみを参照できます。
  - `create.seed` は、ターゲットの `create.fields` 内ですでにリストされているトップレベルのスカラ、列挙、または `belongsTo(...)` フィールドのみを対象にできます。
  - 生成されたハンドオフリンクは、ターゲットの作成ビューを再利用し、サニタイズされたアプリローカルの `returnTo` を渡します。
- ページでは、`actions:` を介して洗練された共有選択ハンドオフアクションを宣言することもできます：
  - 各アクションは現在、`create:` のみをサポートしています。
  - `create.resource` は、`create:` を持つ生成されたリソースを参照する必要があります。
  - `create.seed` は `selection: <selectionState>.<resultField>`、`input: <queryState>.<inputField>`、またはスカラリテラルのみを参照できます。
  - `selectionState` は、同じページ上の既存のリードモデルに裏打ちされたテーブルブロックから来ている必要があります。
  - `queryState` は、同じページ上の既存の共有リードモデルクエリ状態グループから来ている必要があります。
  - 生成されたページレベルのハンドオフリンクは、ターゲットの作成ビューを再利用し、必要な全ての選択が存在するまで自身を無効化し、サニタイズされたアプリローカルの `returnTo` を渡します。
- レコードスコープのリレーションページでは、代わりに `data: resourceName.hasManyField` （例：`teams.members`）を使用できます。
- リレーションページルートは、ページ上で `path: /<resource>/:id/...` を宣言する必要があります。
- リレーションページの `data: <resource>.<hasManyField>` は、直接の `hasMany(..., by: ...)` フィールドのみをサポートします。
- 参照されるターゲットリソースが存在する必要があります。
- ターゲットリソースが列を持つ `list:` ビューを定義している場合、生成されたページテーブルはそのターゲットリストの列、リレーション派生フィルター、ソート可能なリレーション列、ページネーション、および洗練された詳細/編集/作成/削除アクションを再利用します。
- 再利用されたページブロックの詳細/編集/作成アクションは、サニタイズされたアプリローカルの `returnTo` を渡します。レコードスコープのリレーションページでは、作成ビューにおいて逆の `belongsTo(...)` フィールドも事前入力されます。
- 生成されたレコードスコープのリレーションページ自体は、サニタイズされたアプリローカルの `returnTo` が存在すればそれを戻り先として使用し、そうでなければ親リソースの詳細ルートまたはリストルートにフォールバックします。
- 生成されたレコードスコープのリレーションページは、親ルートが存在する場合に洗練された親の詳細/編集ヘッダーアクションを提供し、親リソースにワークフローが関連付けられている場合は生成されたヘッダー内に洗練された親のワークフロー状態/リンクを再利用するようになりました。これらのリンクはサニタイズされたアプリローカルの `returnTo` を運びます。
- ターゲットリソースに `list:` インターフェースがない場合、生成されたページテーブルはターゲットのラベルフィールドでキー付けされたシンプルな関連レコードのタグリストにフォールバックします。
- 現在、ページスコープのパラメータは、これらのレコードスコープのリレーションテーブルページとレコードスコープのリレーションカウント指標ブロックに対してのみ有効になっています。ナビゲーションやリダイレクトターゲットはまだページパラメータにバインドされていません。
- 同じレコードスコープのリレーションページ上のカスタムブロックは、生成された props `{ recordId, returnTo, backHref, parentReadHref, parentEditHref, parentRecord, parentLoading, parentError, parentWorkflow, relations }` を介してそのルートコンテキストを再利用できます。ここで `parentWorkflow` は親がワークフローに関連付けられている場合の親リソースのリンクされたワークフロー清单の洗練されたサマリであり、`relations` はそのページですでに宣言されているリレーションアンカーのみをまとめ、洗練されたタイトル/インターフェースの種類、アイテムラベル/詳細/編集/ワークフローのサマリに加えてワークフロー状態ラベル、およびそれらの既存のアンカーが利用可能な場合は再利用された `createHref` を運びます。

現在の指標ブロックルール：

- 一般的な指標/クエリインターフェースは、現在リリースされている名前付きリードモデルカウントおよびレコードスコープのリレーションカウントコンシューマー以外は依然としてプレースホルダーです。
- レコードスコープのリレーションページでは `data: resourceName.hasManyField.count` （例：`teams.members.count`）を使用できます。
- ページでは `data: readModel.name.count` （例：`readModel.flightAvailability.count`）も使用できます。
- `readModel.<name>.count` は、テーブルコンシューマーと同じクエリ状態 `FilterBar`、必須入力ゲート、およびフロントエンドグループルールの `eligibility` / `validate` チェックを再利用しますが、行アクションやリレーションプロジェクションのないカウントのみのインターフェースとして留まります。
- 名前付きリードモデルカウントの再利用では `queryState: <name>` も設定でき、同じ `inputs:` を持つ他のリードモデルテーブル/カウントコンシューマーとクエリ状態を共有できます。
- 参照先のリードモデルが存在する必要があります。`list:` を定義している必要はありません。
- リレーションページルートは、ページ上で `path: /<resource>/:id/...` を宣言する必要があります。
- リレーションページの `data: <resource>.<hasManyField>.count` は、直接の `hasMany(..., by: ...)` フィールドのみをサポートします。
- 参照されるターゲットリソースが存在する必要があります。`list:` を定義している必要はありません。
- 生成されたページは、サニタイズされたアプリローカルの `returnTo` が存在すればそれを戻り先として使用し、そうでなければ親リソースの詳細ルートまたはリストルートにフォールバックします。
- 親リソースに `read:` または `edit:` が定義されている場合、生成されたページヘッダーはそれらの親ルートをサニタイズされたアプリローカルの `returnTo` と共に再利用します。

レコードスコープのリレーションページの例：

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

## 式言語 (ルール)

ルールには、JavaScript ではなく、**制約された式言語**を使用します。

### サポートされているもの

```
# 比較
currentUser.role == "admin"
record.status != "suspended"
record.count > 10

# 論理演算子
hasRole(currentUser, "admin") && record.status == "active"
isOwner(currentUser, record) || hasRole(currentUser, "admin")
not isEmpty(record.name)

# 組み込み関数
hasRole(subject, "roleName")    # ロールのチェック
isOwner(subject, record)        # 所有権のチェック
isEmpty(field)                  # 空かどうかのチェック
isNotEmpty(field)               # 空でないかどうかのチェック
count(collection)               # 項目のカウント
```

### サポートされていないもの (意図的)

- ループ
- 変数への代入
- 任意の関数呼び出し
- クロージャまたはインポート
- インラインの JavaScript

---

## エフェクト言語 (onSuccess)

エフェクトは、アクション成功後に実行される有限の副作用セットです。

| エフェクト | 構文 | 説明 |
|--------|--------|-------------|
| `refresh` | `- refresh: resourceName` | データの更新/再読み込み |
| `invalidate` | `- invalidate: resourceName` | キャッシュの無効化 |
| `toast` | `- toast: "message"` または記述オブジェクト | 通知の表示 |
| `redirect` | `- redirect: users.list` | ルートへの遷移 |
| `openDialog` | `- openDialog: dialogName` | モダン（ダイアログ）の展開 |
| `emitEvent` | `- emitEvent: eventName` | カスタムイベントの発行 |

---

現在の制約：

- `toast` は、静的な文字列または記述オブジェクト（descriptor object）のいずれかを受け入れます。
- 固定のコピーには静的な文字列のみを使用してください。値が挿入される場合や、将来の国際化 (i18n) が重要な場合は、最初から記述オブジェクトを優先してください。
- 文字列メッセージ内に変数値を埋め込まないでください（補完）。
- 記述子の `values` には、スカラリテラルまたは `{ ref: <path> }` のみを含めることができます。
- 現在サポートされている `ref` のルートは以下の通りです：
  - `form.<field>`
  - 編集ビューのみ: `record.<field>`
  - `user.<field>`
  - 編集ビューのみ: `params.id`
- 将来の i18n サポートは、フロントエンドファミリーのソースファイル内でのインラインテンプレート構文ではなく、構造化された記述子を通じて拡張される予定です。

記述子形式の `toast` の例：

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

サポートされていない例：

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

基本的なアプリシェルレベルの視覚的意図が安定しており、生の CSS の使用を避けたいものの、`.web.loj` のビジネス構造内に配置するには不適切な場合は、`.style.loj` を使用してください。

現在のフックポイント：

- `app.style: '@style("./styles/theme")'`
- `page.style`
- `page.blocks[].style`
- `resource.list.style`
- `resource.read.style`
- `resource.create.style`
- `resource.edit.style`
- `resource.workflow.style` （`workflow: { source, style }` を介して関連付け）

構文例：

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

現在サポートされている style プロパティ：

- レイアウトと配置：
  - `display: row | column | stack`
  - `gap`
  - `padding`
  - `paddingHorizontal`
  - `paddingVertical`
  - `alignItems: start | center | end | stretch`
  - `justifyContent: start | center | end | spaceBetween | spaceAround`
- サイズ制御：
  - `width`
  - `minHeight`
  - `maxWidth`
- サーフェス材質：
  - `backgroundColor`
  - `borderRadius`
  - `borderWidth`
  - `borderColor`
  - `elevation`
- タイポグラフィとテキスト：
  - `typography`
  - `color`
  - `opacity`
- 継承：
  - `extends`
- エスケープ：
  - `escape.css`

トークン参照ルール：

- `gap`, `padding`, `paddingHorizontal`, `paddingVertical` は `spacing` から解決されます
- `borderRadius` は `borderRadius` から解決されます
- `elevation` は `elevation` から解決されます
- `backgroundColor`, `borderColor`, `color` は `colors` から解決されます
- `typography` は `typography` から解決されます

現在のスタイルのガードレール：

- `.style.loj` は、「シェルレベルの」スタイル意図のためのみに使用してください。
- テーブルの内部ロジックや、フォームの細かなセクション、関係読み取りパネルの詳細など、完全なレスポンシブ動作に関するファーストクラスのサポートはこのレイヤーでは期待しないでください。
- `escape.css` は、フロントエンドファミリー固有の制限付きエスケープ定義空間です。
- 特定の DOM 構成や独自の CSS セレクタとの強い結合が必要な視覚要件の場合は、共有可能な Style DSL の普遍性を保つために、直接的なエスケープハッチに頼るかホスト側の CSS コンポーネントを使用してください。

スタイルのエスケープの例：

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

## エスケープハッチシステム (2軸)

DSL で表現できない場合は、エスケープハッチを使用します。ここには**独立した 2 つの軸**があります。

### ロジックエスケープハッチ (ビジネスロジック用)

#### @expr(...) — 純粋な TS 式 (最も安全。これを優先してください)
組み込みの式言語では処理できないインラインロジック用。文（Statement）、インポート、副作用は使用できません。
```yaml
rules:
  visibleIf: '@expr(currentUser?.role === "admin" && record?.status !== "archived")'
```

現在の `@expr(...)` ランタイムコンテキストでは、`currentUser`、`record`、および `formData` が使用可能です。

#### @fn(...) — 外部関数参照
式にするには複雑すぎるが、フルコンポーネントを作るほどではないロジック用。関数をエクスポートする `.ts` ファイルを参照します。
```yaml
rules:
  allowIf: '@fn("./logic/canEditUser.ts")'
```

ルール：
- 関数シグネチャ: `export default function name(context: { currentUser, record, formData }) { return boolean; }`
- 同期関数である必要があります。
- 外部 API を呼び出してはいけません（さもなければ純粋なロジックではありません）。

### UI エスケープハッチ (カスタムレンダリング用)

#### Column での @custom(...) — カスタムセルレンダラー
```yaml
columns:
  - avatar @custom("./components/AvatarCell.tsx")
```
Props: `{ value, record }`

#### Field での @custom(...) — カスタムフィールドコンポーネント
```yaml
fields:
  - avatar @custom("./components/AvatarUploader.tsx")
```
Props: `{ value, onChange }`

#### Block での custom: — カスタムブロックコンポーネント
```yaml
blocks:
  - type: custom
    title: "Revenue"
    custom: "./components/RevenueChart.tsx"
```

### ⚠️ エスケープ予算
コンパイラはエスケープハッチの使用状況を追跡します。ノードの **20%** 以上がエスケープハッチを使用している場合、警告が発行されます。これは DSL の不適切な負荷や範囲外の要件を示唆しています。

---

## 完全な例

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
    - type: table
      title: "Users"
      data: users.list
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

この約 65 行のファイルから、プロダクショングレードの React/TypeScript コードが、**8 ファイル、約 370 行**生成されます。
