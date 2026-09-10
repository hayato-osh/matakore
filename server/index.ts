import app from './app'

// Cron（scheduled）を足すとき（Phase 3 以降）は、ここに handler を並べる。app 側は触らない。
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
