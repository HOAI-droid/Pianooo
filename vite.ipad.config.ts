// Builds the iPad app's web part (the same React renderer the desktop uses)
// into dist-ipad/, which Capacitor copies into the Xcode project.
//   npm run ipad:build   →   npx cap sync ios   →   open ios/App in Xcode
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, relative, join } from 'path'
import { readFileSync, readdirSync, statSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// Bundled songs (public/Demo, public/Katalog), copied into the library on first launch
function listBundled(base: string, dir = base): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listBundled(base, p))
    else if (/\.(mid|midi|kar|musicxml|xml|mxl|gp|gp3|gp4|gp5|gpx|cap|md)$/i.test(name)) out.push(relative(base, p).split('\\').join('/'))
  }
  return out.sort()
}

// Same index.html, but started through the iPad entry point
function ipadEntry(): Plugin {
  return {
    name: 'orfeo-ipad-entry',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html
        .replace('/src/main.tsx', '/src/main.ipad.tsx')
        .replace('<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
          '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />'),
    },
  }
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react(), ipadEntry()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __IPAD_DEMO_FILES__: JSON.stringify(listBundled(resolve(__dirname, 'public/Demo'))),
    __IPAD_CATALOG_FILES__: JSON.stringify(listBundled(resolve(__dirname, 'public/Katalog'))),
  },
  resolve: {
    // electron/exportName.ts is shared with the desktop and imports Node's path
    alias: { path: resolve(__dirname, 'src/platform/ipad/path.ts') },
  },
  optimizeDeps: {
    exclude: ['spessasynth_lib', 'spessasynth_core'],
    include: ['fuse.js'],
  },
  esbuild: { legalComments: 'inline' },
  build: {
    outDir: 'dist-ipad',
    emptyOutDir: true,
    target: 'safari16',
    minify: 'esbuild',
    chunkSizeWarningLimit: 4000,
  },
})
