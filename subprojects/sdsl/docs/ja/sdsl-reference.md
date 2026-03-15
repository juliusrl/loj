# Lojban パラダイム (バックエンドファミリー `.api.loj`) — LLM リファレンスドキュメント

> **目的**: このドキュメントは、現在のバックエンドファミリー MVP スライスにおいて、有効なバックエンドファミリーの `.api.loj` ファイルを生成するための唯一の真実の情報源（Single Source of Truth）です。
> 現在 Spring Boot + Java または FastAPI + Python にコンパイルされる、対象を絞ったターゲット中立なバックエンド DSL を LLM に生成させたい場合に、このドキュメントを与えてください。
>
> リポジトリ固有の AI Skill を使用している場合は、統合ワークフローラッパーとして [skills/loj-authoring/SKILL.md](../../../skills/loj-authoring/SKILL.md) を使用してください。
> このファイルは引き続き、標準の構文およびコントラクトのリファレンスとして機能します。
>
> レガシーに関する注記: 現在のベータサイクルの間、`.sdsl` は引き続きサポート対象のバックエンドファミリーエイリアスです。
>
> 共有コントラクトに関する注記: バックエンドファミリーのソースまたは生成された産物が、リポジトリ内の他の場所でも使用されている安定したコンパイラ中立な記述子形式を再利用する場合、その標準形式は [shared-compiler-contracts.md](../../../docs/shared-compiler-contracts.md) に定義されています。バックエンドファミリーは、同じ記述子形式をアドホックに再定義するのではなく、適切な場所でこれらのコントラクトを再利用する必要があります。

## スキーマバージョン: 0.1.0

---

## 関連ツール

このスキーマスライスに対応する現在のコマンド：

- `sdsl validate <entry.api.loj|entry.sdsl>`
- `sdsl build <entry.api.loj|entry.sdsl> --out-dir <dir>`
- `sdsl dev <entry.api.loj|entry.sdsl> [--out-dir <dir>]`

リポジトリ内の現在のエディタサポート：

- 共有 VSCode 拡張機能が `.api.loj` および旧 `.sdsl` を登録しています。
- バックエンドファミリーのソースファイルに対して、プロジェクトベースの診断（Diagnostics）、ホバー、調査（Inspect）が実装されています。
- 生成されたソースへのトレース（Trace）は、バックエンドファミリーのソースファイルに対してはまだ実装されていません。

リポジトリネイティブなバックエンドの例：

- `subprojects/sdsl/examples/user-service/app.api.loj`
- `subprojects/sdsl/examples/user-service/app.fastapi.api.loj`
- `npm run mvn:test --workspace=@loj/example-user-service` は、生成された CRUD エンドポイントテストを含む、生成された Spring Boot プロジェクトを検証します。
- `npm run py:compile:fastapi --workspace=@loj/example-user-service` は、生成された FastAPI プロジェクトの構文チェックを行います。
- `npm run py:test:fastapi --workspace=@loj/example-user-service` は、生成された FastAPI の依存関係を例専用の仮想環境にインストールし、生成された `pytest` を実行します。

---

## ファイル構造

バックエンドファミリーのソースファイル (`.api.loj`、旧 `.sdsl`) は、**厳密な YAML サブセット**です：

- アンカーは使用不可
- エイリアスは使用不可
- マージキーは使用不可
- カスタムタグは使用不可

バックエンドファミリーの `.api.loj` スライスは 2 つのプロジェクト形式をサポートしています：

- **単一ファイルアプリ**: `app:`、オプションの `compiler:`、およびセマンティック定義を含む 1 つのルート `.api.loj` ファイル。
- **ルート・プラス・モジュールアプリ**: オプションの `imports:` を含む 1 つのルート `.api.loj` ファイルと、セマンティックなモジュールファイル。インポートされたモジュールは、さらに他のモジュールをインポートすることも可能です。

単一ファイルアプリは、`imports:` を持たないルートファイルに相当します。

**ルートファイル**のトップレベルキー：

| キー | 必須 | 説明 |
|-----|----------|-------------|
| `app:` | はい | アプリ名や Java のベースパッケージなどのバックエンドプロジェクト設定 |
| `compiler:` | いいえ | コード生成設定。`v0.1` は Spring Boot + Java + `mvc-jpa-security` および FastAPI + Python + `rest-sqlalchemy-auth` をサポート |
| `imports:` | いいえ | ルートのみで使用可能な、追加のバックエンドファミリーモジュールファイルのリスト |
| `model <Name>:` | いいえ | ドメインモデル定義 |
| `resource <name>:` | いいえ | モデルに紐付けられた CRUD REST リソース |
| `readModel <name>:` | いいえ | トラッキング機能を絞り込んだ名前付きの GET 専用リードモデル/検索サーフェス |

**モジュールファイル**のトップレベルキー：

| キー | 許可 | 説明 |
|-----|---------|-------------|
| `model <Name>:` | はい | ドメインモデル定義 |
| `resource <name>:` | はい | CRUD リソース定義 |
| `readModel <name>:` | はい | トラッキング機能を絞り込んだ名前付きの GET 専用リードモデル/検索サーフェス |
| `imports:` | はい | オプションの推移的なモジュールリンク |
| `app:` | いいえ | ルートのみ |
| `compiler:` | いいえ | ルートのみ |

現在のマルチファイルサポートは意図的に限定されています：

- インポートは、相対パスによる `.api.loj` / `.sdsl` ファイル、または `/` で終わる相対ディレクトリパスである必要があります。
- 入れ子になったインポートが可能です。
- インポートの循環は無効であり、インポートチェーンと共に報告されます。
- インポートされた定義は、アプリ全体の 1 つのネームスペースにマージされます。
- `app:` および `compiler:` ブロックを含めることができるのは、依然として 1 つの公式なエントリファイルのみです。
- ディレクトリインポートは、その直下のバックエンドファミリーソースファイルのみを展開し、辞書順にソートされます。

ファイル間でのモデル名、リソース名、またはリードモデル (readModel) 名の重複はエラーとなります。

アプリケーションには、最低でも以下のセマンティクスサーフェスのいずれか 1 つが存在しなければなりません：

- `resource <name>:` もしくは `readModel <name>:`
- `model <Name>:` は `resource` ブロックにとって必須ですが、ハンドラーのみを持つリードモデルサービスにとっては必須ではありません。

推奨されるデフォルト：

- 小規模なデモやプロンプトサイズのバックエンド：単一ファイル
- より大きなサービス定義：`imports:` を使用してドメインごとに分割

---

## `app:` ブロック

`app:` はバックエンドプロジェクトのアイデンティティとパッケージ構成（Layout）にのみ使用してください。

```yaml
app:
  name: "User Service"                  # 必須。人間が読めるアプリ名。
  package: "com.example.userservice"    # 必須。バックエンドファミリーのネームスペース / パッケージルート。
```

ルール：

- `name` は必須です。
- `package` は必須です。
- `package` は有効なドット区切りの Java パッケージ形式である必要があります。
- 認証プロバイダー、データベースベンダーの上書き、ビジネスロジックなどを `app:` に記述しないでください。

`v0.1` における生成されるプロジェクトのデフォルトは、選択されたバックエンドターゲット/プロファイルに依存します：

- Spring Boot + Java -> Maven + H2 ローカル設定
- FastAPI + Python -> `pyproject.toml` + SQLite ローカル設定

---

## `compiler:` ブロック

このブロックはコード生成の設定にのみ使用してください。

```yaml
compiler:
  target: spring-boot
  language: java
  profile: mvc-jpa-security
```

スキーマ `0.1.0` におけるルール：

- 已実装の有効なターゲットトリプルは以下の通りです：
  - `spring-boot / java / mvc-jpa-security`
  - `fastapi / python / rest-sqlalchemy-auth`
- `target`、`language`、および `profile` は、実装済みのトリプルのいずれかを形成する必要があります。

省略された場合、コンパイラは `spring-boot / java / mvc-jpa-security` が選択されたものとして動作します。

このブロックは、将来のスキーマバージョンで以下を追加できるように存在します：

- `language: kotlin`
- 代替の Spring プロファイル
- FastAPI 以外の代替のバックエンドターゲット

Java/Kotlin を `target` にエンコードしないでください。

---

## `imports:` ブロック

明示的なモジュールリンクには `imports:` を使用します。

```yaml
imports:
  - ./models/user.api.loj
  - ./resources/users.api.loj
```

ルール：

- 各エントリは、相対的な `.api.loj` / `.sdsl` ファイルパス、または `/` で終わる相対ディレクトリパスである必要があります。
- インポートの順序によってセマンティックな意味が変わることはありません。
- インポートされたファイルは、ルートファイルと同じグローバルネームスペースを共有します。
- モジュールファイルは独自の `imports:` を含めることができます。
- インポートの循環は無効です。
- ディレクトリインポートは、その直下のバックエンドファミリーソースファイルのみを、パスの辞書順に展開します。
- ディレクトリインポートは再帰的ではありません。
- ルートファイルは、引き続きローカルに `model` および `resource` 定義を持つことができます。

推奨される分割の指針：

- モデルが `1-3` 個、リソースが `1-2` 個：1 つのファイルにまとめる
- モデルが `4` 個以上、またはリソースが `3` 個以上：ドメインごとに分割

---

## `model <Name>:` ブロック

以下を生成するドメインモデルを定義します：

- JPA エンティティ
- リクエスト/レスポンス DTO
- バリデーションメタデータ

例：

```yaml
model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, EDITOR, VIEWER)
  active: boolean
  createdAt: datetime @createdAt
```

生成される永続化アイデンティティは暗黙的です：

```yaml
id: long   # 自動生成されます。v0.1 では手動で宣言しないでください。
```

### フィールド型

| 型 | Java | 説明 |
|------|------|-------------|
| `string` | `String` | テキストフィールド |
| `text` | `String` | 長いテキストフィールド |
| `integer` | `Integer` | 整数 |
| `long` | `Long` | 大きな整数 |
| `decimal` | `BigDecimal` | 小数 |
| `boolean` | `Boolean` | 真偽値 |
| `datetime` | `Instant` | 日付/時刻 |
| `date` | `LocalDate` | カレンダー上の日付 |
| `enum(A, B, C)` | 生成された enum | 列挙値 |
| `belongsTo(Model)` | `Long` / 関連 ID | 別のモデルへの洗練された外部キーリレーション |
| `hasMany(Model, by: field)` | メタデータのみ | 派生した逆リレーションメタデータ。カラムや DTO フィールドはまだ生成されません |

### フィールドデコレータ

| デコレータ | 説明 |
|-----------|-------------|
| `@required` | フィールドが必須 |
| `@email` | 有効なメール形式である必要がある |
| `@unique` | ユニーク制約を生成 |
| `@minLen(n)` | 最小文字列長 |
| `@maxLen(n)` | 最大文字列長 |
| `@createdAt` | 生成される作成タイムスタンプ |
| `@updatedAt` | 生成される更新タイムスタンプ |

ルール：

- `@email` は `string` にのみ適用されます。
- `@minLen` と `@maxLen` は `string` または `text` にのみ適用されます。
- `@createdAt` と `@updatedAt` は `datetime` にのみ適用されます。
- `@unique` は永続化層の関心事であり、リソース横断的なクエリ言語ではありません。
- `belongsTo(Model)` は `Model` が存在することを要求します。
- `hasMany(Model, by: field)` は `Model` が存在し、`by:` がターゲットモデル上の `belongsTo(CurrentModel)` フィールドを指していることを要求します。
- 現在のバックエンドファミリーのスライスでは、`belongsTo(...)` を単一の外部キーリレーションとして扱います。
- 生成されたリクエスト/レスポンス DTO は、展開されたネストオブジェクトではなく、関連レコード ID を露出させます。
- `hasMany(...)` は逆行メタデータとしてのみ機能します。ストレージ、エンティティフィールド、またはリクエスト/レスポンス DTO フィールドは作成されません。
- `hasMany(...)` 逆フィールドはフィールドデコレータをサポートしません。

現在の非目標：

- 宣言されたリレーション上でのリレーション考慮のプロジェクション。
- ソース DSL 内でのカスタム SQL/JPA アノテーション。
- 手動でのプライマリキー定義。

---

## `readModel <name>:` ブロック

機能範囲を意図的に絞り込んだ読み取り専用クエリ（例：カスタム検索やレポート）向けの表現サーフェスを定義します。クエリの実体はターゲット特有のエスケープハッチハンドラによって提供されます。

例：

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

洗練された SQL エスケープの例：

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

### 必須キー

| キー | 必須 | 説明 |
|-----|----------|-------------|
| `api:` | はい | 固定の GET ルートパスである必要があります |
| `result:` | はい | 行/結果の形状 |
| `handler:` | はい | リードモデルを実装するターゲット言語の関数体スライス |
| `auth:` | いいえ | このリードモデル独自のセキュリティ規則 |
| `inputs:` | いいえ | クエリ入力。入力ゼロのリードモデルの場合は、省略するか空のままにします |
| `rules:` | いいえ | 洗練されたリンク済みの `.rules.loj` 資格（Eligibility）/派生サーフェス |

ルール：

- 現在の read-models は意図的に機能範囲を制限しています：
  - 固定の `GET` ルートのみを許容します。
  - 結果の戻り値はリストに限定されます。
  - 名前付きのサーフェスマッピングのみを許容します。
  - バックエンドファミリー内に自由な SQL Join 操作やクエリビルダ構文は提供されません。
- `api` は必ず `/` から始まる必要があります。
- `auth:` はリソース定義の `auth` と同様に `mode` / `roles` を持つ形状を再利用します。
- readModel 単独の `auth.policy` サポートは現時点ではありません。このスコープでのアクセス制御は、`mode` / `roles` に加えてローカルハンドラー内で解決してください。
- `inputs:` および `result:` は `model` と同じようなフィールド構築形状を使用しますが、現在のリードモデルの世界では単純なスカラー表現のみが許されます。
- 現状の `inputs:` では `@required` のみサポートされています。
- 現状の `inputs:` は `datetime` には対応していません。こちらでは `date` または `string` を指定してください。
- 現状の `result:` フィールドについては任意のデコレータ記述を禁止しています。
- `handler:` 属性では `@fn("./path")` または `@sql("./path")` のいずれかを指定する必要があります。
- `handler:` に指定するパスは、ファイル拡張子を取り除いたロジカルなマッピングを推奨します。
- 言語環境のパス解決としては：`spring-boot/java` の場合 `.java`、`fastapi/python` には `.py` が引き当てられます。
- 特定言語の拡張子 `.java` / `.py` を意図して付与した場合、それは明示的なその言語に対する一極集中結合指定(Lock-in)と解釈されます。
- `@sql(...)` は現在拡張子 `.sql` を解決します。
- `@sql(...)` は次のように著しく機能制限されています：
  - これは read-model のハンドラーにのみ許可されます。
  - `.api.loj` 内に長大な SQL 文をインライン展開しないため、必ず別ファイルから参照する必要があります。
  - 中身は常に読み取り専用の `SELECT` / `WITH` クエリとしてください。
  - ストアドプロシージャの呼び出し、`CALL`、および書き込み系操作はここでは厳格に許可されません。
  - 返却される結果のカラムのエイリアス群は、必ず `result:` 定義内のフィールド群の命名と一致させなければなりません。
- `rules:` はオプショナルですが、付与する場合は `@rules("./rules/x")` の書式を通す必要があります。
- `rules:` でのパス指定時も拡張子なしが公式に推奨されています。
- この `rules:` 連携での現在サポート項目は以下の 3 つのみです：
  - `eligibility <name>` (実行前適格性チェック)
  - `validate <name>` (入力バリデーション)
  - `derive <field>` (取得データに対するフィールド計算)
- ここでは以下の利用は禁止されています：
  - `allow/deny <operation>`
- `derive <field>` に関しては、存在する `result:` 内のプロパティをターゲットにしなければなりません。
- 加えて現在の `derive <field>` 処理は、`date` / `datetime` 以外の基本スカラー値のみをサポートします。
- read-model のルールの計算評価式内部に許可されている参照は以下の通りです：
  - `currentUser.id`、`currentUser.username`、`currentUser.role`、`currentUser.roles`
  - `input.<field>`
  - (derive内限定) `item.<resultField>`
  - （内部的にEnumのように解釈される）`ADMIN` などの大文字トークン文字列
- Spring Boot 環境に対しては、内部でコントローラとアダプタが生成され、ハンドラーに対して `PolicyPrincipal.fromAuthentication(authentication)` を渡すよう動作します。
- また Spring Boot 生成コードは、これら `eligibility` + `validation` + `derivation` のヘルパー群を型安全なクラスに包んで対象ハンドラーを前後からサンドイッチします。
- FastAPI に対しても同様に、対応するセッションラッパーと `principal` 渡し (または `None`) の構造を持つルートが生成されます。
- FastAPI のハンドラー群でも、型適用された各適格・検証ヘルパーがハンドラの前後に配置処理されます。
- 重要な点として、対象となるハンドラースニペット群は**特定環境に向けたエスケープラッパーにすぎない**ことを忘れないでください。クエリビルダー構造、ORM固有操作語、およびフレームワーク別名称を直接バックエンドファミリーの標準DSL内に侵略・記法化しないでください。
- どうしても必要な場合、抽出したネイティブSQLのファイルや、言語特有のハンドラスニペット内部において固有 ORM を組み込んで動かすことは許容されます。それはエスケープハッチの内部でのみ妥当です。
- 生の SQL スニペットをそのまま CRUD 生成やあらゆる要件における「一般的な標準パス」として甘用させるのはやめましょう。もし複数環境で類似のクエリパターンが繰り返されるなら、SQL を直接 Loj DSL に標準化記載するのではなく、まずは概念的なモデルプリミティブを拡充させて抽象化できないかを検討してください。

現在のハンドラースニペット（snippet）コントラクト規約：

- ハンドラーファイルは、一連の MVC コントローラ・サービスなどの大枠を担う巨大なモジュール構成ファイルではありません。あくまでもターゲット言語上で動く「特定関数のごくごく一部の抜粋処理 (function-body snippet)」です。
- Spring に向けたハンドラースニペットは、シグネチャ `List<ReadModelResult> execute(ReadModelInput input, PolicyPrincipal principal)` の内側コンテキストとして解釈され動作します。
- FastAPI の場合のハンドラースニペットの実行コンテキストは `def execute(db: Session, input: ReadModelInput, principal: AuthenticatedUser | None) -> list[ReadModelResult]` です。
- Spring ハンドラーアダプタは、それに加えて環境固有の脱獄クエリ対応がエスケープハッチ側に留まれるよう、内部で生成された全リポジトリのみならず直接扱える `EntityManager` をもインジェクトして待ち構えてくれます。

現在の非目標：

- 幅広い応用性を持つクエリ統合組み立て機能の設計。
- クエリプッシュダウン用 DSL (Query pushdown DSL)。
- Write（書き込み側）制約の整備やセマンティクス設計。
- オペレーション別の柔軟な `auth` 上書き表現。
- バックエンドが持つリードモデルを（このDSL仕様レイヤーを直接介したまま）フロントエンドからダイレクト参照すること。
- メインとなるバックエンドファミリー DSL そのものに組み込まれる生のソースレベル SQL ラッパー DSL、またはデータベースベンダー特有キーワードのコア機能への導入。

---

## `resource <name>:` ブロック

モデルを REST API サーフェスおよび生成されるセキュリティルールに紐付けます。

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

### 必須キー

| キー | 必須 | 説明 |
|-----|----------|-------------|
| `model:` | はい | モデル名への参照 |
| `api:` | はい | ベース REST パス |
| `auth:` | いいえ | このリソースのセキュリティルール |
| `workflow:` | いいえ | 洗練されたリンク済みの `.flow.loj` ライフサイクル表面 |
| `create:` | いいえ | 集約ルートに付随する洗練されたネストされた作成 (nested create) のセマンティクス |
| `update:` | いいえ | 集約ルートに付随する洗練された一段下の層に限定されたネスト更新/差分 (nested update/diff) セマンティクス |
| `operations:` | いいえ | どの CRUD エンドポイントを生成するか |

### `auth:` ブロック

Spring の内部仕様ではなく、洗練されたポリシーの意図（Intent）を記述するために `auth:` を使用します。

```yaml
auth:
  mode: authenticated   # "public" | "authenticated"
  roles: [ADMIN, SUPPORT]
  policy: '@fn("./policies/canManageUsers")'
```

ルール：

- `mode` はデフォルトで `authenticated` です。
- `mode: public` の場合、`roles` は省略してください。
- `mode: public` の場合、`policy` 指定も省略する必要があります。
- `roles` は「認証済みユーザーはこれらのロールのいずれかを持っている必要がある」ことを意味します。
- ロール名は `ROLE_` プレフィックスのない大文字の識別子である必要があります。
- `policy` は任意で付与するオプション値であり、組み込みの mode/role チェックと同列に追加動作します。
- 現在 `policy` には以下の 2 通りの記法が許可されます：
  - `@fn("./policies/canManageUsers")` 
  - `@rules("./policies/order-access")` 
- どちらの参照指定でも拡張子なし（Extensionless）マッピング形式の使用が推奨されます。
- `@fn(...)` に対する現在の各ターゲット・言語別解決は、それぞれ `spring-boot/java` = `.java`、`fastapi/python` = `.py` へと解決されます。
- ただし明確な `.java` / `.py` 拡張子が書かれた場合、それは「意図されたロックイン指定」として扱われます。
- `@rules(...)` に関しては拡張子なし指定か、明確に `.rules.loj` サフィックスを付けた形式の両方が有効指定として受け入れられます。

### `workflow:`

洗練された `.flow.loj` ライフサイクルをリソースにリンクするために `workflow:` を記述します。

```yaml
workflow: '@flow("./workflows/booking-lifecycle")'
```

ルール：

- `workflow:` はオプショナル定義であり、参照の際は `@flow("./workflows/x")` の形状を使用します。
- `workflow:` に関しても拡張子を省いたファイル参照構造の記述が推奨されます。
- 拡張子 `.flow.loj` を含んだ記載も、明確なロックイン行為として容認されます。
- リンク先となる外部の workflow 側の `model` 定義情報と、この親リソースとしての `model` 参照は、必ず一致している必要があります。
- このリンク先の外部ワークフローが紐付けられる対象状態フィールド `field` は、このモデル上に定義される `enum(...)` に向けられていなければなりません。
- さらに、当該のワークフローには、関連付けられた enum フィールドの取り得る全ての状態が正確に抜け漏れなく網羅されていることが前提となります。
- Spring Boot および FastAPI ターゲットではどちらも、このスライスに対して以下の通りの特設 CREATE/UPDATE アダプタが作成されます。
  - creation（作成）処理では、まず `wizard.steps[].completesWith` に定義があるならそれを利用し、無ければ最初の workflow ステート情報を初期シード状態値として扱います。
  - update（更新）処理時において、通常の更新ペイロードを介した直接的なステート遷移は許容されず、既存の状況状態（current workflow state）が維持・保護されます。
  - ワークフローに連携済みのリソースにおいては、状態強制遷移専用のエンドポイント経路 `POST /.../{id}/transitions/{transition}` が追加で付与されます。
- 現在実装されているターゲットにおいて、生成されたバックエンドワークフローの変異パスは、デフォルトでトランザクション保証内に収まるよう設定されています：
  - Spring 環境下では、生成されたワークフローの作成/更新/遷移サービスパスは `@Transactional` でラップされます。
  - FastAPI 環境下では、生成されたワークフローの作成/更新/遷移サービスパスは、生成された `Session` コミット/回退境界内にラップされます。
- 作成者は、このスライスにおけるワークフロー関連リソースに対して `transactional: true` を追加する必要はありません。
- 状態処理の制御式（transition `allow` expressions）の中で扱える項目は以下のみに限定されています：
  - `currentUser.id`, `currentUser.username`, `currentUser.role`, `currentUser.roles`
  - `record.<field>`
  - `READY` や `TICKETED` などの大文字で表記された裸の Enum 様リテラル
- ウィザード用の工程設定（`wizard.steps`）は共有の workflow 側に引き続き記述されますが、オプション項目としての `surface: form | read | workflow` は定義として機能するようになったものの、バックエンド経路生成では未だ遷移サーフェスの直接的な消費に焦点を絞って処理されています。

現在の非目標：

- プロジェクトシェルのワークフロービジネスオーケストレーション。
- 一般的なロングトランザクションや Saga（サガ）構文。
- ソース DSL 内でのステートマシンライブラリやトランザクションフレームワークの語彙。

### `create:` ブロック

この `create:` の設定口は、集約ルートベースの「洗練されたネスト作成セマンティクス」限定の意味合いでのみ利用してください。

```yaml
create:
  rules: '@rules("./rules/booking-create")'
  includes:
    - field: passengers
      fields: [name, seat]
```

ルール：

- 現在の `create:` の対応範囲は、意図して洗練されたものに絞り込まれています：
  - 単一レベルのサブコレクションに限定されます。
  - 直接的な `hasMany(..., by: ...)` リレーションに限定されます。
- `rules:` 指定はオプションであり、利用する場合は `@rules("./rules/x")` の参照機構を利用します。
- 拡張子を取り除いた指定が推奨されています。
- `create.rules` 内部にて現段階でサポートされている構文は以下の 2 つのみです：
  - `eligibility <name>` (資格検証)
  - `validate <name>` (バリデーション)
- こちらから `create.rules` 設定として以下の機能記述要求は排除/拒否されます：
  - `allow/deny <operation>`
  - `derive <field>`
- `create.rules` に組み込まれる設定式（Expression）では現在、下記項目への参照が許可されています：
  - `currentUser.id`, `currentUser.username`, `currentUser.role`, `currentUser.roles`
  - `payload.<field>`
  - `params.<name>`
  - `ADMIN` などの裸の大文字ラベル
- `includes:` エントリの中で指定される値は、親（リソース）側のモデル上に直下配置されている `hasMany(Target, by: field)` モデルフィールドの参照でなければなりません。
- 子側の `fields:` に挙げられる要素群は、関連先の「子モデル（Target model）」に定義された属性の名称である必要があります。
- 自分と親のリレーションを取り持つ逆参照フィールド（`by:` で指定済みの要素）は、すべて裏側で自動的にシードされるため、記述を省いてください（二重指定しないでください）。
- 子側 `fields:` のプロパティとしては、現在スカラー値、列挙、または子モデル上に置かれた `belongsTo(...)` ターゲットモデルフィールドのみが使用可能です。
- 子側の `fields:` で `hasMany(...)` を使用することはできません。
- Spring は、リソース範囲のネストされた作成用 DTO クラスおよびトランザクション同期サブアイテム永続化を生成します。
- Spring の `create.rules` は、型安全な資格 + 検証ヘルパーを生成し、資格失敗時は `403`、検証失敗時は `400` を出すよう自動対応します。
- FastAPI のコード生成においても同等に、リソース範囲のネストされた作成用 Schema および単一コミットのサブアイテム永続化が生成されます。
- FastAPI の `create.rules` も同様に、型安全な資格 + 検証ヘルパーを生成し、それぞれ `403` および `400` を提供します。
- 現在実装されているターゲットにおいて、生成されたバックエンド作成パスは、デフォルトでトランザクション保証内に収まるよう設定されています：
  - Spring は、生成された作成サービスパスを `@Transactional` 内にラップします。
  - FastAPI は、生成された作成サービスパスを、生成された `Session` コミット/回退境界内にラップします。
- 作成者は、通常の生成された作成パスに対して `transactional: true` を追加する必要はありません。

現在の非目標：

- さらに深いサブアイテムのネスト。
- ソース DSL 内での ORM 特有のカスケード語彙。

### `update:` ブロック

この `update:` 設定ブロックについても、集約ルート側の限定的一段下の層に向けた洗練された差分ネスト更新セマンティクス対応の意味合いでのみ利用してください。

```yaml
update:
  includes:
    - field: passengers
      fields: [name, seat]
```

ルール：

- 現在の `update:` 対応機能エリアも意図して洗練されたものに留めてあります：
  - 単一レベルのサブコレクションに限定されます。
  - リレーションはダイレクトな `hasMany(..., by: ...)` 関係である必要があります。
  - `operations.update` は常に有効にされている必要があります。
- `includes:` エントリが `hasMany` アトリビュートを指すこと、`fields:` が子モデル属性を指すこと、`by:` 定義の逆参照は裏で制御するため記載から除外すること、といった主要ルールは `create:` 実装と同じです。
- `fields:` に与えられる子側項目で利用できる範囲もスカラー値、列挙、または `belongsTo(...)` オブジェクト限定のみとなります。
- 子側の `fields:` で `hasMany(...)` を使用することはできません。
- `id` を持つ入力サブアイテムは、既にその親レコードに属している既存のサブアイテムへの更新としてマッチします。
- `id` を持たない入力サブアイテムは、その親レコードの下に新規サブアイテムとして作成されます。
- 提出されたコレクションから省略された既存のサブアイテムは削除されます。
- Spring は、リソース範囲のネストされた更新用 DTO およびトランザクション同期の単一レベルサブアイテム同期を生成します。
- FastAPI への生成においても同等に、ネストされた更新用 Schema および単一ショットのセッション機構上での同期が生成されます。
- 現在実装されているターゲットにおいて、生成されたバックエンド更新/削除パスは、デフォルトでトランザクション保証内に収まるよう設定されています：
  - Spring は、生成された更新/削除サービスパスを `@Transactional` 内にラップします。
  - FastAPI は、生成された更新/削除サービスパスを、生成された `Session` コミット/回退境界内にラップします。
- 作成者は、通常の生成された更新/削除パスに対して `transactional: true` を追加する必要はありません。

現在の非目標：

- さらに深いサブアイテムのネスト。
- 単一レベルのサブアイテムコレクション以外でのネスト更新/差分。
- ソース DSL 内での ORM 特有のカスケード語彙。

現在のポリシースニペット規約：

- ポリシーファイルはターゲット言語の関数体スライスであり、完全なコントローラ/サービスファイルではありません。
- ブール値を返す必要があります。
- 以下にアクセスできます：
  - `principal`
  - `operation`
  - `params`
  - `payload`

Spring スニペットの例：

```java
return principal.hasRole("ADMIN") && !"delete".equals(operation);
```

FastAPI スニペットの例：

```python
return "ADMIN" in principal.roles and operation != "delete"
```

現在のリンクされたルール（Linked Rules）の動作コントラクト：

```yaml
auth:
  mode: authenticated
  roles: [ADMIN, SALES]
  policy: '@rules("./policies/invoice-access")'
```

- リンクされた `.rules.loj` ファイルは、ターゲットネイティブのバックエンド強制および共有ルールマニフェストへとコンパイルされます。
- 現在のバックエンドに関連付けられたルールのコンテキストは、意図して洗練されています：
  - `currentUser.id` および `currentUser.username` は認証されたユーザー名に解決されます。
  - `currentUser.role` は現在のプライマリロールに解決されます。
  - `currentUser.roles` は現在のロール集合に解決されます。
  - `record.<field>` / `record.id`
  - `payload.<field>`
  - `params.<name>`
  - `ADMIN` や `COMPLETED` などの裸の大文字ラベルは、Enum ライクなリテラルとして扱われます。
- リスト内で用いられる `scopeWhen` / `scope` の扱いは今の時点では、コントローラ/ルート層で生成されたメモリ上のフィルタリングにコンパイルされており、クエリ下推（Query Pushdown）には波及していません。
- 関連付けられたルールの影響範囲は依然としてリソース全体（Resource-level only）に限定されています。各オペレーション別の `auth:` 上書きは未だ `v0.1` には含まれていません。

現在のリンクされた作成ルールのコントラクト：

```yaml
create:
  rules: '@rules("./rules/booking-create")'
```

- リンクされた `.rules.loj` ファイルは、ターゲットネイティブの作成資格 + 検証ヘルパーへとコンパイルされます。
- このスライスでは `eligibility <name>` と `validate <name>` のみが消費されます。
- `allow/deny` および `derive` エントリは、ここでは検証エラーとなります。

現在のリンクされたリードモデルルールのコントラクト：

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

- リンクされた `.rules.loj` ファイルは、ターゲットネイティブのリードモデル資格 + 検証 + 派生ヘルパーへとコンパイルされます。
- このスライスでは `eligibility <name>`、`validate <name>`、および `derive <field>` のみが消費されます。
- `allow/deny` エントリは、ここでは検証エラーとなります。

現在の共通制約事項：

- `auth` はリソース全体に適用されます。
- オペレーションごとの認証上書きは `v0.1` ではありません。
- カスタムバックエンドエスケープハッチは、それぞれのトランザクション境界を保持します：
  - コンパイラは、ターゲットコードに既に存在するものを超えて、`@fn(...)` に対して追加のトランザクションラッパーを生成することはありません。
  - `@sql(...)` は現在リードモデル限定であり、読み取り専用（Read-only）であるため、生成された書き込みトランザクションには関与しません。

### `operations:` ブロック

どの CRUD エンドポイントを生成するかを制御します。

```yaml
operations:
  list: true
  get: true
  create: true
  update: true
  delete: true
```

デフォルト：

- `operations:` が省略された場合、5 つのオペレーションすべてがデフォルトで `true` になります。

ルール：

- `list` は `GET /api/...` を生成します。
- `get` は `GET /api/.../{id}` を生成します。
- `create` は `POST /api/...` を生成します。
- `update` は `PUT /api/.../{id}` を生成します。
- `delete` は `DELETE /api/.../{id}` を生成します。

オペレーションが `false` の場合、そのエンドポイントは生成されません。

---

## 生成される HTTP コントラクト

バックエンド DSL は、`docs/loj-transport-contract.md` にあるリポジトリレベルのトランスポートコントラクトに従う必要があります。

最初に生成される Spring Boot バックエンドにおいて、推奨される公式なエンベロープ（Envelope）は以下の通りです：

### 一覧 (List)

```json
{
  "items": [
    { "id": 1, "name": "Ada", "email": "ada@example.com" }
  ]
}
```

### 単一レコード (Single Record)

```json
{
  "item": { "id": 1, "name": "Ada", "email": "ada@example.com" }
}
```

### エラー (Error)

```json
{
  "message": "Validation failed"
}
```

ルール：

- 返されるすべてのレコードには `id` が含まれている必要があります。
- バックエンドのトランスポートにおいて `id` は数値である可能性があります。現在のフロントエンドランタイムはそれを文字列に強制変換する場合があります。
- `DELETE` は `204 No Content` を返す場合があります。
- API ルートに対してフレームワークデフォルトの HTML エラーページを生成しないでください。
- 現在のバックエンドファミリーのソースは、メッセージテンプレートや記述子構文を定義していません。API エラーは安定した人間が読める `message` に留めてください。

現在の重要な制約：

- サーバー主導のページネーションメタデータは、`v0.1` では**必須ではありません**。
- 最初の SpringDSL スライスにおいて `total`、`page`、または `pageSize` を必須としないでください。

将来、より豊富なページネーションや、より豊富なエラー/i18n エンベロープが必要になった場合は、まず共有トランスポートコントラクトに追加する必要があります。

---

## バリデーションセマンティクス

バリデーションは 2 つの層で存在します：

- コンパイル時の DSL バリデーション
- 生成された Spring コードにおけるランタイムバリデーション

最初の SpringDSL スライスは、モデルのデコレータから Bean Validation メタデータを生成すべきです。

例：

- `@required` -> non-null / non-blank バリデーション
- `@email` -> email バリデーション
- `@minLen(2)` -> 最小サイズバリデーション

現在の非目標：

- リソース横断的なバリデーションルール。
- 任意のバリデーション式。
- DSL から直接参照されるカスタムバリデーションクラス。

---

## `v0.1` でサポートされていないもの

意図的にサポートされていないもの：

- フロントエンドの `page` ブロック
- カスタムクエリ DSL
- 任意のカスタムコントローラーメソッド
- 洗練された `belongsTo(...)`、逆の `hasMany(..., by: ...)`、および単一層の `resource create.includes` / `resource update.includes` 以外の、一般的なリレーションクエリ DSL
- メソッドレベルの認証式
- ソース DSL 内での OAuth/JWT プロバイダー設定
- Kotlin
- Gradle
- WebFlux
- GraphQL
- バックグラウンドジョブやメッセージング
- OpenAPI ファーストのオーサリング
- プロジェクトシェルのワークフロービジネスオーケストレーションや一般的なロングトランザクション構文

これらが必要な場合は、アドホック（その場しのぎ）な構文をでっち上げないでください。まずコントラクトを拡張してください。

---

## 完全な例

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

このファイルは、以下を備えた実行可能な Spring Boot CRUD バックエンドを生成することを目的としています：

- JPA エンティティ + リポジトリ
- サービスレイヤー
- REST コントローラー
- Bean Validation
- Spring Security ロールゲート
- H2 を使用したローカルなサンプル用設定

---
