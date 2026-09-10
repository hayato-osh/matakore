# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現状

`DESIGN.md` §8 の **Phase 2 まで実装済み**。
Phase 0（スキャン → 手入力 → ローカル保存 → 判定表示）、Phase 1（未知の JAN を
`/api/resolve/:jan` 経由で Yahoo!／楽天／Open Food Facts から解決、カテゴリ提案の1タップ承認）に加えて、
Phase 2 として全記録の控えを `/api/sync` で D1 と差分同期する（機種変更で消えない）。
Cron（夜間バッチ）はまだ無い。回す対象（LLM 補完・傾向分析）が Phase 3 以降のため。判定は引き続き完全にローカル完結。

**デプロイ単位は Cloudflare Worker 1本。** PWA（静的アセット）と API（Hono）を同一オリジンから配信する。
`wrangler.jsonc` がルートにあり、`server/` が Worker、`src/` が PWA。`@cloudflare/vite-plugin` で
`pnpm dev` 一発で両方が同じポートに上がる。CORS も API の URL 設定も存在しない。
`wrangler.jsonc` は自分の Cloudflare の値（Access / ドメイン / D1 の ID）を入れる場所なので **git に入れない**。
追跡しているのは `wrangler.example.jsonc`（ローカルはそのままで動く値）で、キーを足したら両方を更新する。

パッケージマネージャは **pnpm**（単一パッケージ。`pnpm-workspace.yaml` は postinstall 許可の設定だけ）。

```bash
pnpm install
cp wrangler.example.jsonc wrangler.jsonc   # ローカルはそのままで動く。デプロイ先の値は自分のものに変える
cp .dev.vars.example .dev.vars   # DEV_NO_AUTH=1 / YAHOO_APP_ID / RAKUTEN_APP_ID（値が空でもキーは残す）
pnpm migrate:local               # D1 をローカルに作る（.wrangler/state）
pnpm dev              # PWA + Worker（/api）を同じポートで
pnpm dev:host         # LAN 公開（スマホ実機から見る用）
HTTPS=1 pnpm dev:host # 自己署名HTTPS。iOS実機でカメラを使うときは必須
pnpm build            # tsc -b && vite build → dist/client（静的）+ dist/matakore（Worker）
pnpm preview          # ビルド結果を Worker ごと動かす（SW・/api・SPA フォールバックの確認）
pnpm deploy           # build して wrangler deploy
pnpm test             # vitest run（src/ と server/ の両方）
pnpm lint             # oxlint
pnpm typecheck        # tsc -b（app / node / worker の3プロジェクト）
pnpm types            # wrangler.jsonc か .dev.vars のキーを変えたら worker-configuration.d.ts を再生成（CI が差分を見る）
```

コードの地図と API 仕様はこのファイルの末尾にある。Cron はまだ1行も存在しない。

## プロダクトの核

「スーパーの棚の前でバーコードを読むと『また買うか』が3秒で分かる」個人用アプリ。設計判断で迷ったら `DESIGN.md` §1.3 の優先順位に従う。

1. 入力の摩擦を減らす（1商品5秒を超えるフローは設計の失敗）
2. 参照が速い（店頭・オフライン・片手で完結）
3. 分析・推薦は上2つが成立してから

## 実装時に効いてくる設計上の制約

コードを読んだだけでは分からず、破ると設計が崩れる決定事項。

- **入力は2フェーズに分割する**（§3.1）。Phase A「捕獲」＝スキャンのみ（JAN + 購入日）、Phase B「評価」＝後から未評価キューで。買う瞬間には評価が存在しないので、1画面で両方取ろうとしてはいけない。
- **評価の主軸は 4値の repeat intent**（`staple` / `yes` / `meh` / `no`）。星5段階は主軸にしない。星は任意の副次情報。
- **判定はローカルデータのみで完結させる**（§6.1）。IndexedDB（Dexie）に全件を持つ。Workers への通信を判定パスに入れない（店内は電波が期待できない）。
- **商品マスタ（`Product`）と評価（`Review`）を厳密に分離する**（§5）。マスタは外部API由来で再取得可能、評価は代替不能。エクスポート／バックアップの単位も別。
- **外部APIの商品情報はスナップショットとしてローカルに保存する**。API が将来死んでも記録が失われないようにするため。
- **API キーはクライアントに置かない**。JAN 解決は必ず同一オリジンの `/api/resolve/:jan` 経由。API の URL は相対パスで固定。
- **認証は Cloudflare Access に任せる**（§6.3）。アプリはトークンを持たず、Worker は `CF_Authorization` の JWT を
  JWKS で検証する。`workers_dev` と `preview_urls` は Access の外なので閉じたまま。ローカルは `.dev.vars` の
  `DEV_NO_AUTH=1` でだけ検証を外す（`wrangler.jsonc` の vars に置かない）。
- **`resolveJan` を呼んでいいのは登録画面だけ**。判定画面・`getVerdict` から呼ぶと §6.1 が崩れる。
- **同期は裏で勝手に走り、何も止めない**（`src/lib/sync.ts`）。判定パスから `syncNow` を呼ばない・待たない。
  圏外・ログイン切れ・Worker 停止のどれでも結果を設定画面に残すだけ。
- **同期対象の4テーブル（products / purchases / reviews / categories）への書き込みは Dexie のミドルウェア
  （`src/db/outbox.ts`）が自動で未送信に積む**。手で積まない。逆に同期に載せたくない書き込み
  （サーバーから受け取った変更・カテゴリのシード・端末だけの全削除）は `silently(tx)` を付けたトランザクションで行う。
  外すと受け取った変更を送り返して無限に回る。
- **ミドルウェアの中で `async/await` を使わない**。Dexie は Promise の連鎖からトランザクションの文脈を辿るので、
  ネイティブの await を挟むと下層（hooks）が文脈を見失う。`.then` で繋ぐ。
- **サーバーの控えの削除は墓標**（`data = NULL`）。行を物理削除すると `seq` が振り直されて別端末が取りこぼす。
- **初回接続はサーバーが正**。ローカルはサーバーが知らない行だけを送る。新しい端末のシードが古い端末で消したものを蘇らせないため。
- **Worker のルートは `/api/*` に閉じる**（`wrangler.jsonc` の `run_worker_first`）。それ以外のパスは静的アセットと
  SPA フォールバックに流れる。Service Worker 側も `/api/` を `navigateFallbackDenylist` で除外している。
- **`server/` は DOM 無し**（`tsconfig.worker.json` の `types: []`）。`src/` と `server/` で共有したい純粋関数は
  片方に置いて import するのではなく、契約（`server/types.ts` ↔ `src/lib/resolver.ts`）を手で対にしておく。
- **EC API は「商品」ではなく「出品」を返す**。`【送料無料】... 140g×5個 まとめ買い` のようなノイズ入りタイトルが来るため、正規化処理を前提に組む。生データは `rawName` に残す。
- **外部APIのジャンル情報は使わない**（§5.1）。自前の2階層カテゴリ（大分類・中分類）を持つ。3階層以上にしない。横断的な性質はタグで表現する。
- **自動カテゴリ分類は必ずユーザーの1タップ承認を挟む**。誤分類は推薦機能の品質を直接壊す。
- **JSON / CSV 完全エクスポートは最初のリリースに含める**（§6.4）。後付けにすると実装されない。
- **アプリ内にログイン画面を作らない**（§6.3）。単一ユーザー前提、Cloudflare Access がオリジンごと守る。

## 見た目の決定事項

デザインは「判取帳」— 帳簿に朱印を押す、という一本の筋で通してある。以下は破ると筋が崩れる。

- **朱は「判定」の色。行動ボタンに使わない。** 印・綴じ代の罫・未評価の催促だけが朱で、
  「買った」などの行動ボタンは墨。棚の前で目が最初に拾うべきものを印に固定するため。
- **日本語の webfont は Zen Kaku Gothic New 一書体（400/700）だけ。** 1ウェイト約0.9MBあり、
  オフライン用に Service Worker へ焼くので、書体やウェイトを足すとそのまま初回DL量に乗る。
  見出しと本文の差は書体ではなく寸法・字間・色・罫でつける。明朝はUIには使わない。
- **スタイルは CSS Modules。グローバルCSSは `styles/tokens.css`（変数）と `styles/global.css`
  （要素セレクタのみ）の2枚だけ**で、ここにクラスを足さない。複数画面で使う見た目は
  クラス文字列を配らず `components/ui/` のプリミティブ（Button / Chip / Field / Screen /
  SectionTitle / Details）か `LedgerRow` に落とす。
- **モジュールを跨いだセレクタを書かない。** 親から子の見た目を変えたいときは
  カスタムプロパティで渡す（例: タブの選択状態 → `--glyph-stroke` → `TabIcon`）。
- **アイコンはアイコンフォントを使わず inline SVG で持つ**（`components/TabIcon.tsx`）。
  外部フォントはオフラインで落ち、1文字のために重い。
- **ダークモードは必須。** トークンは `:root`（和紙）と `[data-theme="dark"]` /
  `prefers-color-scheme: dark`（墨）の3状態で切る。色は必ず CSS 変数を経由し、直書きしない。
- **印の傾きは JAN から決める**（`IntentBadge`）。乱数にすると再描画のたびに揺れてノイズになる。

## バーコード読み取り

`BarcodeDetector` を第一選択、**zxing-wasm フォールバックは必須**（iOS Safari で未実装のため、後回しにすると iPhone 実機で詰む）。検出成功は Vibration API か効果音で返す（画面を見ずにスキャンできるように）。

## 実装順序

`DESIGN.md` §8 のロードマップに従う。Phase 0 を外部API抜きで切ったのは、API カバレッジという最も不確実な要素をコア体験の検証から切り離すため。Phase 1 で JAN 解決を足した今も、**Worker が落ちていても・圏外でも Phase 0 の動線がそのまま成立する**ことを崩さない（解決失敗は全部「手入力に落ちる」だけ）。次は Phase 3（集計ダッシュボード・タグ分析。記録100件が着手ライン）。

推薦機能（§7）はデータが貯まるまで着手しない（集計は100件〜、LLM 嗜好プロファイルは300件〜、類似商品推薦は500件〜）。

---

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
