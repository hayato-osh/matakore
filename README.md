# matakore（またこれ）

スーパーの棚の前でバーコードを読むと「また買うか」が3秒で分かる、個人用の食品評価データベース。
設計の意図と背景は [`DESIGN.md`](./DESIGN.md)、実装時の制約は [`CLAUDE.md`](./CLAUDE.md) にある。

現在の実装範囲は **Phase 2**（`DESIGN.md` §8）。
スキャン → 判定表示までは外部API接続なしで完結し、未知の JAN だけ同一オリジンの `/api` 経由で
Yahoo!ショッピング／楽天市場／Open Food Facts から商品名を引く。API が落ちていても・圏外でも
Phase 0 の動線（手入力）にそのまま落ちる。全記録の控えは裏で同じ Worker の D1 と差分同期しており、
機種変更しても新しい端末でログインして開けば戻る。

## 構成

**Cloudflare Worker 1本**で PWA と API を同一オリジンから配信する（`DESIGN.md` §6.2）。

```
                 https://matakore.<account>.workers.dev
                 ┌──────────────────────────────────────┐
  /            → │ 静的アセット（dist/client）             │  Vite でビルドした PWA。
  /assets/*      │   SPA フォールバック → index.html        │  Service Worker が丸ごと
  /sw.js         │                                        │  プリキャッシュするので圏外でも起動する
                 ├──────────────────────────────────────┤
  /api/*       → │ Worker（server/、Hono）                  │  run_worker_first: ["/api/*"]
                 │   Access の JWT（CF_Authorization）検証   │  API キーはここに隔離
                 │   /api/health  /api/resolve/:jan         │
                 │   /api/sync    /api/backup               │
                 │   D1（共有マスタ・未発見の記憶・記録の控え）│
                 └──────────────────────────────────────┘
```

- 判定は IndexedDB だけで完結する。`/api` を呼ぶのは未知の JAN を登録するときと、裏で記録の控えを D1 と合わせるときだけ。
- 同一オリジンなので CORS も API の URL 設定も無い。認証は Cloudflare Access のクッキーなので、アプリ側に入れるものは何も無い。
- 開発は `@cloudflare/vite-plugin` が Worker を Vite の中で動かすので、`pnpm dev` 一発で `/api` まで動く。
- ビルドは `dist/client`（静的）と `dist/matakore`（Worker + 生成済み `wrangler.json`）に分かれ、
  `wrangler deploy` が後者を自動で拾う。

## 動かす

```bash
pnpm install
cp .dev.vars.example .dev.vars   # DEV_NO_AUTH=1 が入っている。ローカルでは Access 検証を外す
pnpm migrate:local               # D1 をローカルに作る
pnpm dev
```

Yahoo!／楽天のアプリIDが無くても Open Food Facts だけで動く（日本の食品はほぼ引けないが、配線の確認はできる）。
`.dev.vars` のキーは値が空でも消さないこと。`pnpm types` がここからキーを拾って `Env` の型を作る。

スマホ実機で試すとき:

```bash
HTTPS=1 pnpm dev:host
```

カメラ（`getUserMedia`）はセキュアコンテキストでしか動かない。`localhost` は例外扱いだが、
LAN 経由で iPhone から開く場合は HTTPS が必須なので上のコマンドを使う。
自己署名証明書なので初回は警告を踏み越える必要がある。

| コマンド | 内容 |
|---|---|
| `pnpm dev` | PWA + Worker（`/api`）を同じポートで |
| `pnpm dev:host` | LAN に公開 |
| `HTTPS=1 pnpm dev:host` | 自己署名HTTPSつきで LAN に公開 |
| `pnpm build` | 型チェック（`tsc -b`）＋本番ビルド |
| `pnpm preview` | ビルド結果を Worker ごと動かす（Service Worker の挙動もここで見る） |
| `pnpm deploy` | build して `wrangler deploy` |
| `pnpm test` | 単体テスト（`src/` はデータ層と lib、`server/` はカスケードと Hono のルート） |
| `pnpm lint` | oxlint |
| `pnpm typecheck` | `tsc -b`（app / node / worker） |
| `pnpm types` | `worker-configuration.d.ts` を再生成 |
| `pnpm migrate:local` / `migrate:remote` | D1 マイグレーション |

## 使い方

1. **スキャン** タブでバーコードを読む
   - 既知の商品 → 判定画面
   - 未知の商品 → 登録画面。商品名・メーカー・画像が自動で入る（Yahoo!／楽天／OFF）。
     入らなければ商品名だけ打てば終わり
   - 商品名からカテゴリを提案する。提案は**1タップで承認**するまで確定しない
   - 読めないときは JAN を手入力できる
2. **判定画面** で「買った」を押すと購入イベントが1件増える
3. 食べたあと **未評価** タブから1タップで評価する（`◎ 定番` / `○ また買う` / `△ 微妙` / `✕ もういい`）
4. **設定** タブから JSON / CSV でいつでも全部持ち出せる
5. 記録は裏で D1 に同期される（書き込みの少し後・アプリに戻ったとき・電波が戻ったとき）。
   機種変更したら新しい端末でログインして開くだけ。設定タブに未送信件数と最終同期が出る

## API

```
GET /api/health           → { ok, sources: ['yahoo','rakuten','off'], user }
GET /api/resolve/:jan     → { jan, found: true, product: { rawName, brand?, imageUrl?, source, fetchedAt }, cached }
                          | { jan, found: false, cached }
    ?refresh=1            キャッシュを飛ばして取り直す

POST /api/sync            { cursor, changes: [{ tbl, key, data | null, at }] }
                          → { cursor, changes: [...], more }
GET  /api/backup          → アプリのエクスポートと同じ形の JSON（アプリ無しでも取り出せる）
DELETE /api/sync          → サーバーの控えを全部墓標にする（別の端末にも削除が伝わる）
```

解決のカスケード（§4.2）: D1 の共有マスタ → Yahoo! → 楽天 → OFF。外部3ソースは優先順を保ったまま
並列に叩き、優先順に見て最初に当たったものを返す（上位が当たれば下位は待たない）。
見つからなかった JAN も 7 日間覚えておくが、どれかのソースがタイムアウトした回の「未発見」は覚えない。

### 差分同期（Phase 2）

`records`（D1）にユーザーの全記録（products / purchases / reviews / categories）を JSON のまま置く。
主体は Access の email。1往復で「未送信の変更を送る → cursor より後の変更を受け取る」の両方をやる。

- クライアント側は Dexie のミドルウェア（`src/db/outbox.ts`）が4テーブルへの書き込みを横取りし、
  同じトランザクションで `outbox` に (tbl, key) を積む。`repo.ts` を通らない書き込み（カテゴリ追加・インポート）も漏れない。
  中身は積まず送るときに現在の行を読むので、同じ行を何度直しても1件で済む。行が無ければ削除として送る
- 衝突は「新しい方が勝つ」（`at` = 端末での変更時刻）。負けた側にはサーバーの版を返して上書きさせる。
  未来の時刻は受け付けない（時計の進んだ端末に永遠に勝たせない）
- 削除は行を消さず `data = NULL` の墓標にする。`seq` はユーザー内で単調増加し、これが cursor になる
- 初回接続はサーバーが正。全部受け取ってから、サーバーが知らない行だけを送る。
  新しい端末のカテゴリのシードが、古い端末で消したカテゴリを蘇らせないため
- 同期は判定パスに一切関わらない。圏外・ログイン切れ・Worker 停止のどれでも、何も止めずに結果だけを設定画面に残す

## 認証（Cloudflare Access）

オリジン全体を Cloudflare Access で守る（§6.3）。アプリ内にログイン画面もトークン欄も無い。

- 初回にアプリを開くと Cloudflare のログイン画面（メール OTP など）が出る。通ると `CF_Authorization`
  クッキーが付き、以後はセッションが続く限り何も聞かれない。
- Worker は `/api/*` でそのクッキー（RS256 の JWT）を Access の JWKS で検証する。`aud` と `iss` も見る。
  クッキーが無い・改ざん・別アプリ・期限切れはすべて 401。
- `workers.dev` とプレビュー URL は Access の外側になるので `wrangler.jsonc` で閉じてある。
- セッションが切れると `/api` は 302 を返す。アプリは `redirect: 'manual'` で追わずに「ログインが切れている」と
  表示し、「開き直す」で `/api/login` へ遷移させる。トップ（`/`）を開き直しても Service Worker が precache の
  index.html を返してネットワークに出ないため、ログイン画面には辿り着けない。`/api/*` は SW の外なので、
  ここだけは必ず Access を通り、ログイン後に Worker が `/` へ戻す。判定はローカルだけで動くので、切れていても店頭では困らない。
- ローカル開発（`vite dev`）の前には Access がいないので、`.dev.vars` の `DEV_NO_AUTH=1` でだけ検証を外す。

Access アプリの作り方（Cloudflare ダッシュボード）:

1. Zero Trust → Access → Applications → Add an application → **Self-hosted**
2. Application domain に `matakore.example.com`（パスは空＝全体）
3. Session duration は長め（1 か月）にする。店頭で毎回ログインさせない
4. Policy: Allow、Include に自分のメールアドレス
5. 作成後の Overview にある **Application Audience (AUD) Tag** と、Zero Trust の **Team domain**
   （`<team>.cloudflareaccess.com`）を `wrangler.jsonc` の `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` に入れて `pnpm deploy`

## デプロイ

本番は **https://matakore.example.com**（Worker Custom Domain。DNS と証明書は Cloudflare が持つ）。
D1 `matakore` は作成済みで、その ID が `wrangler.jsonc` に入っている。

```bash
npx wrangler login
pnpm deploy                              # build して wrangler deploy。ルートとカスタムドメインもここで同期される
pnpm migrate:remote                      # migrations/ に追加があったとき（Phase 2 の records テーブルはここで作る）
npx wrangler secret put YAHOO_APP_ID     # https://e.developer.yahoo.co.jp/ の Client ID
npx wrangler secret put RAKUTEN_APP_ID   # https://webservice.rakuten.co.jp/ のアプリID
```

別アカウントに立てるときは `npx wrangler d1 create matakore` で出た `database_id`、自分のゾーンのホスト名、
Access の `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` を `wrangler.jsonc` に書き換えてから同じ手順を踏む。

スマホで URL を開いてログインし、ホーム画面に追加する。iOS はホーム画面アプリと Safari で
保存領域（クッキー・IndexedDB）が別なので、記録はホーム画面側で付け始めること。

## デザイン

「判取帳」— 帳簿に朱印を押す。このアプリが返すのは情報ではなく**判定**なので、判定を押印として扱う。

- **朱は判定の色**。印・綴じ代の罫・未評価の催促だけに使い、行動ボタンは墨にしてある。
  棚の前で目が最初に拾うべきものを印に固定するため。
- **◎○△✕ の4色インク**（朱・藍・山吹・墨）。判別の主は記号で、色は補強。
- **書体は2声**。日本語は Zen Kaku Gothic New 一書体（400/700）、
  JAN・日付・数値だけ DM Mono。見出しと本文の差は寸法・字間・罫でつける。
- **和紙と墨の2版**。`prefers-color-scheme` に追従し、設定から手動で固定もできる。
- webfont は CDN ではなくバンドル同梱。電波のない店内で字が代替フォントに落ちないようにするため、
  日本語1書体2ウェイト（約1.9MB）を Service Worker に焼いている。書体を足すと初回DL量に直結する。
- 商品画像は外部URLをそのまま参照する小さな添付写真扱い（`ProductThumb`）。オフラインで落ちたら黙って消える。
  判定の主役は印であって写真ではない。

## コードの地図

```
wrangler.jsonc          Worker の設定。assets（SPA）/ run_worker_first["/api/*"] / D1 / Access の vars / workers_dev: false
migrations/             D1 スキーマ（products = 共有マスタ、misses = 未発見の記憶、records = 記録の控え）
.dev.vars.example       ローカルの秘密のひな形（DEV_NO_AUTH / YAHOO_APP_ID / RAKUTEN_APP_ID）
worker-configuration.d.ts  `pnpm types` が生成する Env と Workers ランタイムの型（手で書かない）

server/                 Cloudflare Worker（DOM 無し。tsconfig.worker.json）
├── index.ts            fetch ハンドラのエクスポート。Cron を足すならここに scheduled を並べる
├── app.ts              Hono。/api/* の Access JWT 検証・/health・/resolve/:jan・/sync・/backup・JSON エラー
├── resolve.ts          カスケード本体（キャッシュ → 並列ソース → 保存）
├── cache.ts            D1 の読み書き（テストでは in-memory に差し替え）
├── sync.ts             差分同期の本体（検証・新旧比較・ページング・墓標・バックアップの組み立て）
├── records.ts          records テーブルの読み書き（テストでは in-memory に差し替え）
├── sources/            yahoo / rakuten / off の各アダプタと共通の fetchJson（5秒で切る）
├── jan.ts              チェックディジット検証（不正な JAN で外部APIを叩かない）
└── types.ts            PWA 側 src/lib/resolver.ts / src/lib/sync.ts と対になる契約

src/                    PWA
├── db/
│   ├── types.ts        Product / Purchase / Review / Category（§5 のデータモデル）
│   ├── db.ts           Dexie スキーマ。全件をここに持ち、判定は完全にローカルで閉じる
│   ├── outbox.ts       同期用ミドルウェア。4テーブルへの書き込みを未送信（outbox）に積む
│   ├── categories.ts   2階層固定カテゴリのシード（約60件）
│   ├── repo.ts         判定ビューの組み立て、未評価キュー、保存系
│   └── export.ts       JSON / CSV エクスポートとインポート（§6.4）
├── lib/
│   ├── scanner.ts      BarcodeDetector → zxing-wasm フォールバック
│   ├── jan.ts          EAN-13 / EAN-8 のチェックディジット検証
│   ├── api.ts          /api を呼ぶ共通部分（Access のログイン切れ検出・圏外判定）
│   ├── resolver.ts     /api/resolve/:jan を呼ぶ。登録画面からしか呼ばない
│   ├── sync.ts         /api/sync との差分同期。起動時・書き込み後・復帰時・電波復帰時に裏で走る
│   ├── classify.ts     商品名キーワード → カテゴリ提案（確定はユーザーの1タップ）
│   ├── normalize.ts    出品タイトルのノイズ除去（§4.2）
│   ├── feedback.ts     検出成功の振動と効果音
│   ├── theme.ts        和紙／墨／自動の切り替え
│   ├── intent.ts       repeat intent の4値
│   ├── nav.ts          画面スタック（ルーターは入れていない）
│   └── cx.ts           CSS Modules のクラス合成
├── styles/
│   ├── tokens.css      色・書体の変数（昼／夜）。グローバルはここと global.css だけ
│   ├── global.css      要素セレクタのリセット。クラスは置かない
│   ├── layout.module.css  並べ方だけの共有（row / actions / stack / footer / list）
│   └── text.module.css    文字まわりの共有（muted / small / mono / empty / flash / error）
├── components/
│   ├── ui/             Button, Chip, Field, Screen, SectionTitle, Details
│   ├── CameraScanner   カメラとトンボ
│   ├── IntentBadge     印（◎○△✕）
│   ├── LedgerRow       一覧・未評価・関連記録で共通の行
│   ├── CategoryPicker  2階層カテゴリの選択
│   ├── ProductThumb    外部API由来の商品画像（読めなければ消える）
│   ├── RelatedList     同カテゴリ／同メーカーの記録
│   └── TabIcon         線画アイコン
└── screens/            スキャン / 判定 / 登録 / 評価 / 未評価 / 一覧 / 設定
```

スタイルは CSS Modules。`*.module.css` を隣に置き、複数画面で使う見た目はクラス文字列ではなく
`components/ui/` のプリミティブに落としてある。モジュールを跨いだセレクタは書かず、
親から子へはカスタムプロパティで渡す。

## 実装上の判断メモ

- **バーコード読み取り**: `BarcodeDetector` があれば使い、無ければ `zxing-wasm` に落ちる。
  iOS Safari には `BarcodeDetector` が無いので、フォールバックは飾りではなく本線。
  wasm は CDN ではなくバンドル同梱のものを Service Worker でプリキャッシュしている（店内で電波が無くても読める）。
- **画面中央の帯だけをデコードする**。フレーム全体を毎回読むと wasm 側が遅く、精度も落ちる。
- **チェックディジットが通らない読み取りは捨てる**。誤読で別商品の判定を出す方が事故が大きい。
- **判定画面は未登録商品でも空にしない**。同カテゴリ・同メーカーの過去評価を出す（§3.2）。
- **商品名は正規化して保存し、元の表記は `rawName` に残す**。API 由来なら API の生タイトルが `rawName`。
  正規化は Worker ではなくクライアントで行う（Worker は生データを返すだけにして、正規化の改善で再デプロイしない）。
- **解決を待たせない**。登録画面は `/api` の応答を待たずに入力できる。結果は商品名が空のときにだけ流し込む。
  8 秒で諦めて手入力に落ちる。
- **未発見の記憶は「全ソースが正常に無いと答えた」ときだけ**。タイムアウトした回を7日分の「無い」に
  してしまうと、新商品を店頭で読むたびに手入力になる。
- **楽天は JAN 専用パラメータが無い**ので keyword 検索。無関係な出品が混ざりうる前提で、
  登録画面では取得元を明示し、名前をそのまま編集できるようにしている。

## まだ無いもの

`DESIGN.md` §8 の Phase 3 以降。

- 夜間バッチ（Cron）。LLM によるカテゴリ補完、傾向分析の事前計算。回す対象がまだ無いので置いていない
- 集計ダッシュボード、LLM 嗜好プロファイル、類似商品推薦
  （集計は記録100件、プロファイルは300件、推薦は500件が着手ライン）
