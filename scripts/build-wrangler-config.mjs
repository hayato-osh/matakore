// wrangler.jsonc は git に入れない（fork した人に他人のアカウントの値が付いてこないように）。
// CI ではひな形（wrangler.example.jsonc）を読み、自分のアカウントの識別子だけを差し込んで組み立てる。
// 値は GitHub の Variables から環境変数で渡す。秘密ではなく公開識別子なので Secrets ではない
// （Access のチーム名と AUD は、未ログインで本番を叩いたときのリダイレクト URL にそのまま出る）。
//
// 使い方: ACCESS_TEAM_DOMAIN=... ACCESS_AUD=... CUSTOM_DOMAIN=... D1_DATABASE_ID=... \
//         node scripts/build-wrangler-config.mjs > wrangler.jsonc
import { readFileSync } from 'node:fs'

const REQUIRED = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'CUSTOM_DOMAIN', 'D1_DATABASE_ID']

const missing = REQUIRED.filter((k) => !process.env[k])
if (missing.length > 0) {
  console.error(`次の値が空です: ${missing.join(', ')}`)
  console.error('リポジトリの Settings → Secrets and variables → Actions → Variables に入れる。')
  process.exit(1)
}

// ひな形は行頭コメント（//）だけを使う。文字列の中の // は消さない
const src = readFileSync(new URL('../wrangler.example.jsonc', import.meta.url), 'utf8')
const config = JSON.parse(
  src
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n'),
)

config.vars.ACCESS_TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN
config.vars.ACCESS_AUD = process.env.ACCESS_AUD
config.routes = [{ pattern: process.env.CUSTOM_DOMAIN, custom_domain: true }]
config.d1_databases[0].database_id = process.env.D1_DATABASE_ID

// ひな形の構造が変わって差し込み先が消えていたら、気づかずに placeholder のままデプロイしない
const leftovers = JSON.stringify(config).match(/example\.com|0{8}-0{4}/g)
if (leftovers) {
  console.error(`ひな形の placeholder が残っている: ${leftovers.join(', ')}`)
  process.exit(1)
}

process.stdout.write(JSON.stringify(config, null, 2) + '\n')
