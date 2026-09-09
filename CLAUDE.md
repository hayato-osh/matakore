# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現状

`DESIGN.md` §8 の **Phase 1 まで実装済み**。
Phase 0（スキャン → 手入力 → ローカル保存 → 判定表示）に加えて、未知の JAN を
`/api/resolve/:jan` 経由で Yahoo!／楽天／Open Food Facts から解決し、
商品名・メーカー・画像を登録画面に自動で流し込む。キーワードによるカテゴリ提案（1タップ承認）も入っている。
D1 との差分同期・Cron（Phase 2 以降）は未実装。判定は引き続き完全にローカル完結。

**デプロイ単位は Cloudflare Worker 1本。** PWA（静的アセット）と API（Hono）を同一オリジンから配信する。
`wrangler.jsonc` がルートにあり、`server/` が Worker、`src/` が PWA。`@cloudflare/vite-plugin` で
`pnpm dev` 一発で両方が同じポートに上がる。CORS も API の URL 設定も存在しない。

パッケージマネージャは **pnpm**（単一パッケージ。`pnpm-workspace.yaml` は postinstall 許可の設定だけ）。

```bash
pnpm install
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
pnpm types            # wrangler.jsonc か .dev.vars のキーを変えたら worker-configuration.d.ts を再生成
```

コードの地図は `README.md` を見ること。D1 同期（`/api/sync`）と Cron はまだ1行も存在しない。

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

`DESIGN.md` §8 のロードマップに従う。Phase 0 を外部API抜きで切ったのは、API カバレッジという最も不確実な要素をコア体験の検証から切り離すため。Phase 1 で JAN 解決を足した今も、**Worker が落ちていても・圏外でも Phase 0 の動線がそのまま成立する**ことを崩さない（解決失敗は全部「手入力に落ちる」だけ）。次は Phase 2（D1 同期・機種変更で消えない）。

推薦機能（§7）はデータが貯まるまで着手しない（集計は100件〜、LLM 嗜好プロファイルは300件〜、類似商品推薦は500件〜）。
