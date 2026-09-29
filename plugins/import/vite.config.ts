import type { Plugin } from 'vite'

// Generate the small manifest consumed by plugin-webui directly. The workspace has
// Vite 7 (Cordis) and Vite 8 (Vitest); UnoCSS can attach CSS using the latter's maps,
// which Vite 7's built-in manifest hook cannot read. All emitted assets are included.
const manifest: Plugin = {
  name: 'magpie:import-manifest',
  generateBundle(_, bundle) {
    const chunks = Object.fromEntries(
      Object.values(bundle).map((chunk) => [
        chunk.fileName,
        {
          file: chunk.fileName,
          isEntry: chunk.type === 'chunk' && chunk.isEntry,
        },
      ]),
    )
    this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(chunks) })
  },
}
export default { build: { manifest: false }, plugins: [manifest] }
