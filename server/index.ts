import app from './app'

// Phase 2 で Cron（scheduled）を足すときは、ここに handler を並べる。app 側は触らない。
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>
