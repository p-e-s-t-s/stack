import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import yaml from '@cordisjs/unyaml/vite'
import vue from '@vitejs/plugin-vue'
import uno from 'unocss/preset-uno'
import unocss from 'unocss/vite'
import { defineConfig, type Plugin, searchForWorkspaceRoot } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// Vendor modules that plugin entries import at runtime. plugin-webui rewrites an entry's
// `import 'vue'` to the file listed under `resolve` in dist/manifest.json, so each vendor
// is built as its own entry chunk with its full export signature.
// chunk name → module specifier
const vendors: Record<string, string> = { vue: 'vue', client: '@cordisjs/client' }

function manifest(): Plugin {
  return {
    name: 'magpie:webui-manifest',
    apply: 'build',
    generateBundle(_, bundle) {
      const resolve: Record<string, string> = {}
      const hash = createHash('sha256')
      for (const chunk of Object.values(bundle)) {
        hash.update(chunk.fileName)
        if (chunk.type === 'chunk' && chunk.isEntry && chunk.name in vendors) {
          resolve[vendors[chunk.name]!] = chunk.fileName
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify({ version: hash.digest('hex'), resolve }, null, 2),
      })
    },
  }
}

// Used by the dev server (plugin-webui runs Vite through @cordisjs/client, which already
// adds the Vue plugin, and merges this file in) and by `npm run build`, which produces ../dist.
export default defineConfig(({ command }) => ({
  root,
  // same plugins @cordisjs/client uses for its dev server
  plugins:
    command === 'build'
      ? [vue(), yaml(), unocss({ presets: [uno({ preflight: false })] }), manifest()]
      : [],
  server: {
    // plugin-webui only allows the config directory; plugins and node_modules live here
    fs: { allow: [searchForWorkspaceRoot(root)] },
  },
  define: command === 'build' ? { 'process.env.NODE_ENV': '"production"' } : {},
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: '',
    rollupOptions: {
      input: { index: root + 'index.html', ...vendors },
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: '[name]-[hash].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
}))
