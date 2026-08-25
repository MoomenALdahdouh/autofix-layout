import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }
import { extensionTarget } from './build/target.ts'

const target = extensionTarget(process.env.LAYFIX_BROWSER)

function extraApiHostPermissions(): string[] {
  const raw = process.env.VITE_API_BASE_URL
  if (!raw) return []
  try {
    const url = new URL(raw)
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return []
    return [`${url.origin}/*`]
  } catch {
    return []
  }
}

export default defineConfig({
  plugins: [
    react(), // must run before crx() so Fast Refresh is wired
    crx({
      manifest: {
        ...manifest,
        name: target.name,
        host_permissions: [
          ...manifest.host_permissions,
          ...extraApiHostPermissions(),
        ],
      },
      // Dev HMR reloads every tab that has the content script when the
      // service worker drops. That looks like the page refreshing every ~5s
      // or on each keystroke. Rebuilds still write to the target outDir;
      // reload the extension manually after code changes.
      liveReload: false,
      contentScripts: { hmrTimeout: 60_000 },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true, // CRXJS embeds this port in the loaded extension
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5173,
    },
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
  legacy: {
    skipWebSocketTokenCheck: true, // Vite 6+ WS token check breaks extension HMR
  },
  build: {
    outDir: target.outDir,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      preserveEntrySignatures: 'exports-only',
    },
  },
})
