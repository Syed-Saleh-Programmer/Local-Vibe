import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
    nodePolyfills({
      protocolImports: true,
    }),
  ],
  define: {
    global: 'window',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
}))
