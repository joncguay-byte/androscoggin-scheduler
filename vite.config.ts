import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const buildId = new Date().toISOString()

function buildVersionPlugin(): Plugin {
  return {
    name: "build-version-plugin",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ buildId }, null, 2)
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildVersionPlugin()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("@supabase")) return "supabase"
          if (id.includes("@tanstack/react-query")) return "react-query"
          if (id.includes("lucide-react")) return "icons"
          return "vendor"
        }
      }
    }
  },
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId)
  }
})
