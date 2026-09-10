# コードの地図と API

`README.md`（何をするものか・立て方）と `DESIGN.md`（なぜそう作ったか）の間を埋める、
実装を触るときの地図。制約そのものは `CLAUDE.md` にある。

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

## コードの地図

```
wrangler.example.jsonc  Worker の設定のひな形。assets（SPA）/ run_worker_first["/api/*"] / D1 / Access の vars / workers_dev: false
wrangler.jsonc          ↑ をコピーして自分の値を入れたもの（git に入れない）
migrations/             D1 スキーマ（products = 共有マスタ、misses = 未発見の記憶、records = 記録の控え）
.dev.vars.example       ローカルの秘密のひな形（DEV_NO_AUTH / YAHOO_APP_ID / RAKUTEN_APP_ID）
.github/workflows/      CI（lint / typecheck / test / 生成物の差分 / build）。デプロイは自動化しない
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
│   ├── export.ts       JSON / CSV エクスポートとインポート（§6.4）
│   └── validate.ts     同期の受信とインポートに共通の行の検証。壊れた行は飛ばす
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
