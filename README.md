# matakore（またこれ）

スーパーの棚の前でバーコードを読むと「また買うか」が3秒で分かる、個人用の食品評価データベース。
設計の意図と背景は [`DESIGN.md`](./DESIGN.md)、実装時の制約は [`CLAUDE.md`](./CLAUDE.md) にある。

現在の実装範囲は **Phase 0**（`DESIGN.md` §8）。
スキャン → 手入力 → ローカル保存 → 判定表示までが、外部API接続なしで完結する。

## 動かす

```bash
pnpm install
pnpm dev
```

スマホ実機で試すとき:

```bash
HTTPS=1 pnpm dev:host
```

カメラ（`getUserMedia`）はセキュアコンテキストでしか動かない。`localhost` は例外扱いだが、
LAN 経由で iPhone から開く場合は HTTPS が必須なので上のコマンドを使う。
自己署名証明書なので初回は警告を踏み越える必要がある。

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバ |
| `pnpm dev:host` | LAN に公開 |
| `HTTPS=1 pnpm dev:host` | 自己署名HTTPSつきで LAN に公開 |
| `pnpm build` | 型チェック（`tsc -b`）＋本番ビルド |
| `pnpm preview` | ビルド結果を確認（Service Worker の挙動もここで見る） |
| `pnpm test` | データ層の単体テスト（vitest + fake-indexeddb） |
| `pnpm lint` | oxlint |

## 使い方

1. **スキャン** タブでバーコードを読む
   - 既知の商品 → 判定画面
   - 未知の商品 → 登録画面（商品名だけ入れれば終わり）
   - 読めないときは JAN を手入力できる
2. **判定画面** で「買った」を押すと購入イベントが1件増える
3. 食べたあと **未評価** タブから1タップで評価する（`◎ 定番` / `○ また買う` / `△ 微妙` / `✕ もういい`）
4. **設定** タブから JSON / CSV でいつでも全部持ち出せる

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

## コードの地図

```
src/
├── db/
│   ├── types.ts        Product / Purchase / Review / Category（§5 のデータモデル）
│   ├── db.ts           Dexie スキーマ。全件をここに持ち、判定は完全にローカルで閉じる
│   ├── categories.ts   2階層固定カテゴリのシード（約60件）
│   ├── repo.ts         判定ビューの組み立て、未評価キュー、保存系
│   └── export.ts       JSON / CSV エクスポートとインポート（§6.4）
├── lib/
│   ├── scanner.ts      BarcodeDetector → zxing-wasm フォールバック
│   ├── jan.ts          EAN-13 / EAN-8 のチェックディジット検証
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
- **商品名は正規化して保存し、元の表記は `rawName` に残す**。Phase 1 で EC API を繋いだときに
  そのまま通せるよう、正規化処理を先に置いてある。

## まだ無いもの

`DESIGN.md` §8 の Phase 1 以降。

- JAN マスタ解決（Cloudflare Workers の `/resolve/:jan` プロキシ、Yahoo!/楽天/OFF のカスケード）
- D1 との差分同期、夜間バッチ（カテゴリ自動分類、傾向分析）
- 集計ダッシュボード、LLM 嗜好プロファイル、類似商品推薦
  （集計は記録100件、プロファイルは300件、推薦は500件が着手ライン）
