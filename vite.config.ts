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
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId)
  }
})
