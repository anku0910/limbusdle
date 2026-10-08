import { defineConfig } from 'vite'
import { dbPlugin } from './vite-plugin-db.ts'

export default defineConfig({
  // Relative asset URLs so `dist/` can be served from any sub-path, not just a domain root.
  base: './',

  plugins: [dbPlugin()],
  // Allow `vite preview` to be exposed through a Cloudflare quick tunnel for public demos.
  preview: {
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    // The 352 KiB identity table plus the pinyin map would otherwise be inlined into the
    // main chunk; splitting them out keeps the app shell a separately cacheable
    // download. Rolldown (Vite 8) only accepts the function form of `manualChunks`.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('src/data/')) return 'data'
          return undefined
        },
      },
    },
  },
})