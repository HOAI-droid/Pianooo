// ── iPad bridge ──────────────────────────────────────────────────────────────
// On the desktop, the renderer talks to Electron's main process through
// window.electronAPI (electron/preload.ts). This file provides the same API
// inside the iPad app. File, library and save logic is the desktop code itself
// (mainPort.generated.ts) running on the iPad file layer (vfs.ts); the rest is
// re-done for iPadOS (file picker, Files app, share sheet, in-app browser).

import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Browser } from '@capacitor/browser'
import { Share } from '@capacitor/share'
import * as vfs from './vfs'
import { DOCUMENTS, DATA } from './vfs'
import { join, basename, dirname, extname } from './path'
import { handlers, loadPrefs, savePrefs } from './mainPort.generated'
import { showMessageBox } from './messageBox'

declare const __IPAD_DEMO_FILES__: string[]
declare const __IPAD_CATALOG_FILES__: string[]

const MIDI_EXT = /\.(mid|midi|kar|musicxml|xml|mxl|gp|gp3|gp4|gp5|gpx|cap)$/i
const LIBRARY = DOCUMENTS
const SOUNDFONTS = `${DATA}/soundfonts`
const INBOX = `${DATA}/Inbox`
const ZOOM_STEPS = [80, 90, 100, 110, 125, 150, 175, 200]

const call = (name: string, ...args: any[]) => {
  const fn = handlers[name]
  if (!fn) throw new Error(`iPad bridge: missing handler ${name}`)
  return Promise.resolve(fn(null, ...args))
}

// ── File picker (opens the iPadOS document browser) ──────────────────────────
function pickFiles(accept?: string): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.style.display = 'none'
    let done = false
    const finish = (files: File[]) => {
      if (done) return
      done = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => finish([]))
    document.body.appendChild(input)
    input.click()
  })
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

// Collision-safe name in `dir`: "Song.mid", "Song (2).mid", …
function freePath(dir: string, name: string): string {
  const ext = extname(name), stem = name.slice(0, name.length - ext.length)
  let candidate = join(dir, name)
  for (let n = 2; vfs.existsSync(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// Puts a picked file into the library root; reuses an identical copy that is
// already there instead of piling up "(2)", "(3)" duplicates.
function importIntoLibrary(name: string, bytes: Uint8Array): string {
  const existing = join(LIBRARY, name)
  if (vfs.existsSync(existing)) {
    try { if (sameBytes(new Uint8Array(vfs.readFileSync(existing)), bytes)) return existing } catch {}
  }
  const dest = freePath(LIBRARY, name)
  vfs.writeFileSync(dest, bytes)
  return dest
}

// ── Drag & drop: getPathForFile must answer synchronously, so the dropped
// file is copied into the Inbox in the background and anything that reads
// that path waits for it first. ───────────────────────────────────────────
const pendingInbox = new Map<string, Promise<void>>()
async function waitInbox(...paths: string[]) {
  await Promise.all(paths.map(p => pendingInbox.get(p)).filter(Boolean))
}

// ── Bundled demo songs → Documents/Demo (only ones that are missing, like the
// desktop's copyDemoFilesRecursive, so songs the user deleted stay deleted
// once seeded) ──────────────────────────────────────────────────────────────
async function copyBundled(srcDir: string, files: string[], destFor: (rel: string) => string) {
  for (const rel of files) {
    const dest = destFor(rel)
    if (vfs.existsSync(dest)) continue
    try {
      // encodeURI, not encodeURIComponent: servers that decode paths with
      // decodeURI would leave %2C / %26 as-is and miss "Sonate, 1. Satz.mid"
      const seg = (x: string) => encodeURI(x).replace(/#/g, '%23').replace(/\?/g, '%3F')
      const res = await fetch(new URL(`./${srcDir}/${rel.split('/').map(seg).join('/')}`, location.href).href)
      const bytes = new Uint8Array(await res.arrayBuffer())
      // Never store a server's HTML fallback page as a song
      if (res.ok && !(bytes[0] === 0x3c && /html/i.test(res.headers.get('content-type') ?? ''))) vfs.writeFileSync(dest, bytes)
      else console.warn('[Pianooo] bundled file missing:', rel)
    } catch (e) { console.warn('[Pianooo] copy failed:', rel, e) }
  }
}

// The starter catalog (public/Katalog, see catalog/katalog.json): its level
// folders go straight into the library root, its credits next to them.
// Re-copied only when the bundled catalog changes, so new pieces arrive with
// an app update while pieces the user deleted stay deleted until then.
const CATALOG_VERSION = `${__IPAD_CATALOG_FILES__.length}:${__IPAD_CATALOG_FILES__.join('|').length}`
function catalogDest(rel: string): string {
  return rel === 'QUELLEN.md' ? join(LIBRARY, 'Katalog – Quellen und Lizenzen.md') : join(LIBRARY, rel)
}

async function seedDemos() {
  const prefs = loadPrefs()
  if (!prefs.ipadDemosSeeded) {
    await copyBundled('Demo', __IPAD_DEMO_FILES__, rel => join(LIBRARY, 'Demo', rel))
    savePrefs({ ipadDemosSeeded: true })
  }
  if (prefs.ipadCatalogVersion !== CATALOG_VERSION) {
    await copyBundled('Katalog', __IPAD_CATALOG_FILES__, catalogDest)
    savePrefs({ ipadCatalogVersion: CATALOG_VERSION })
  }
}

// ── Soundfonts (Samples engine extras) ───────────────────────────────────────
const SOUNDFONT_CATALOG: Record<string, { name: string; filename: string; sizeMB: number; url: string }> = {
  // Pianos, unpacked from FreePats and served from this repo's "soundfonts"
  // release (.github/workflows/soundfonts.yml; credits in SOUNDFONTS-CREDITS.md)
  'kawai-upright-kw': {
    name: 'Kawai Upright Piano', filename: 'Kawai-Upright-Piano-KW.sf2', sizeMB: 60,
    url: 'https://github.com/HOAI-droid/Pianooo/releases/download/soundfonts/Kawai-Upright-Piano-KW.sf2',
  },
  'yamaha-ydp-grand': {
    name: 'Yamaha Grand Piano (Disklavier)', filename: 'Yamaha-YDP-Grand-Piano.sf2', sizeMB: 60,
    url: 'https://github.com/HOAI-droid/Pianooo/releases/download/soundfonts/Yamaha-YDP-Grand-Piano.sf2',
  },
  'fluidr3-gm': {
    name: 'FluidR3 GM', filename: 'FluidR3_GM.sf2', sizeMB: 142,
    url: 'https://github.com/fhunleth/midi_synth/releases/download/v0.1.0/FluidR3_GM.sf2',
  },
  'musescore-general': {
    name: 'MuseScore General', filename: 'MuseScore_General.sf3', sizeMB: 38,
    url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3',
  },
}
const CUSTOM_SF_PREFIX = 'custom:'
function soundfontPath(id: string): string | null {
  if (id.startsWith(CUSTOM_SF_PREFIX)) {
    const filename = id.slice(CUSTOM_SF_PREFIX.length)
    return basename(filename) === filename ? join(SOUNDFONTS, filename) : null
  }
  const entry = SOUNDFONT_CATALOG[id]
  return entry ? join(SOUNDFONTS, entry.filename) : null
}
let soundfontProgress: ((d: { id: string; progress: number }) => void) | null = null

async function readSoundfontBytes(p: string): Promise<ArrayBuffer | null> {
  // Native: stream the file through the web view instead of a giant base64 string
  if (Capacitor.isNativePlatform()) {
    try {
      const { uri } = await Filesystem.getUri({ directory: Directory.Data, path: p.slice(DATA.length + 1) })
      const res = await fetch(Capacitor.convertFileSrc(uri))
      if (res.ok) return await res.arrayBuffer()
    } catch {}
  }
  const bytes = await vfs.readLargeFile(p)
  return bytes ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : null
}

// ── Files app: shareddocuments:// opens the Files app at a folder ────────────
async function openInFiles(virtualPath: string) {
  if (!Capacitor.isNativePlatform() || !virtualPath.startsWith(DOCUMENTS)) return
  try {
    const { uri } = await Filesystem.getUri({ directory: Directory.Documents, path: virtualPath.slice(DOCUMENTS.length + 1) })
    window.location.href = uri.replace(/^file:\/\//, 'shareddocuments://')
  } catch (e) { console.warn('[Orfeo iPad] could not open Files:', e) }
}

async function shareFile(virtualPath: string) {
  if (!Capacitor.isNativePlatform()) return
  try {
    await vfs.flush()
    const dir = virtualPath.startsWith(DOCUMENTS) ? Directory.Documents : Directory.Data
    const root = virtualPath.startsWith(DOCUMENTS) ? DOCUMENTS : DATA
    const { uri } = await Filesystem.getUri({ directory: dir, path: virtualPath.slice(root.length + 1) })
    await Share.share({ files: [uri] })
  } catch (e) { console.warn('[Orfeo iPad] share failed:', e) }
}

// ── Sheet music: a PDF with the song's name next to it ──────────────────────
// "Song.mid" → "Song.pdf". A saved version ("Pianooo/Song_ORFEO_v2.mid") uses
// the original's sheet ("Song.pdf" one folder up).
function findSheet(midiPath: string): string | null {
  if (!midiPath) return null
  const dir = dirname(midiPath)
  const base = basename(midiPath).replace(/\.[^.]+$/, '')
  const original = base.replace(/_ORFEO_(v\d+|IMPORTED)$/i, '')
  const candidates = [
    join(dir, `${base}.pdf`),
    join(dir, `${original}.pdf`),
    join(dirname(dir), `${original}.pdf`),
  ]
  const lower = (p: string) => p.toLowerCase()
  for (const c of candidates) {
    if (vfs.existsSync(c)) return c
    // Files app copies may differ in letter case (".PDF")
    const hit = vfs.readdirSync(dirname(c)).find(n => lower(join(dirname(c), n)) === lower(c))
    if (hit) return join(dirname(c), hit)
  }
  return null
}

async function printFile(path: string): Promise<boolean> {
  if (Capacitor.isPluginAvailable('PianoooFiles')) {
    await vfs.flush()
    try { return (await (PianoooFiles as any).printFile({ path })).printed === true } catch { return false }
  }
  // Browser: print through a hidden frame
  const bytes = await vfs.readFileAsync(path)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0'
  frame.src = url
  document.body.appendChild(frame)
  frame.onload = () => { frame.contentWindow?.print(); setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60000) }
  return true
}

// ── Zoom: the iPad equivalent of Ctrl +/− is the viewport scale ──────────────
const zoomListeners = new Set<(d: { percent: number; capped: boolean }) => void>()
function applyZoom(percent: number) {
  const meta = document.querySelector('meta[name=viewport]')
  const scale = percent / 100
  meta?.setAttribute('content', `width=device-width, initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, user-scalable=no, viewport-fit=cover`)
}

// ── The API ──────────────────────────────────────────────────────────────────
function createApi(): Window['electronAPI'] {
  return {
    // Native audio engine is Windows-only
    connectNativeAudio: async () => ({ ok: false, reason: 'The native engine is not available on iPad.' }),
    nativeSoundfontPaths: async () => [],
    onNativeAudioHostExit: () => {},

    openMidiFile: async () => {
      const [file] = await pickFiles()
      if (!file) return null
      if (!MIDI_EXT.test(file.name)) {
        await showMessageBox({ buttons: ['OK'], message: 'Unsupported file type', detail: 'Pianooo opens .mid, .midi, .kar, MusicXML, Guitar Pro and Capella files.' })
        return null
      }
      const bytes = await fileBytes(file)
      const filePath = importIntoLibrary(file.name, bytes)
      return { fileName: basename(filePath), filePath, base64: vfs.bytesToBase64(bytes) }
    },
    windowMinimize: async () => {},
    windowMaximize: async () => {},
    windowClose: async () => {},

    getPrefs: () => call('prefs:get'),
    setPrefs: (data) => call('prefs:set', data),

    // The library is the app's Documents folder (shown as "Orfeo" in Files)
    openFolder: async () => { savePrefs({ libraryFolder: LIBRARY }); return LIBRARY },
    scanMidiFolder: async (path) => { await vfs.refresh(DOCUMENTS); return call('fs:scanMidiFolder', path) },
    getDemoFolder: async () => null, // demos live inside the library (Documents/Demo)
    loadMidiFromPath: async (path) => { await waitInbox(path); return call('fs:loadMidiFromPath', path) },
    saveExport: (songPath, libraryFolder, fileName, bytes) => call('export:save', songPath, libraryFolder, fileName, bytes),
    statFiles: (paths) => call('fs:statFiles', paths),

    saveFileDialog: async (opts) => {
      // No save panel on iPad: save next to where the desktop would suggest,
      // inside the library, never over an existing file
      const name = basename(opts.defaultPath || 'Untitled.mid')
      return freePath(join(LIBRARY, 'Pianooo'), name)
    },
    saveMidiEditor: (payload) => call('editor:save', payload),
    saveMixerChannels: (payload) => call('mixer:save', payload),
    saveNoteEditor: (payload) => call('noteEditor:save', payload),
    saveTempoKey: (payload) => call('tempoKey:save', payload),
    transcriptGenerate: async () => ({ success: false, error: 'Chord chart PDFs are not available on iPad yet.' }),
    showMessageBox: (opts) => showMessageBox(opts),
    confirmClose: async () => {},
    setFullScreen: async () => {},
    onSaveBeforeClose: () => {},
    offSaveBeforeClose: () => {},

    openExternal: async (url) => {
      if (/^https?:/i.test(url)) await Browser.open({ url })
      else window.location.href = url
    },
    openFolderInExplorer: async (folderPath) => { await openInFiles(folderPath); return '' },
    showItemInFolder: async (filePath) => {
      // Share sheet: save to Files, AirDrop, mail …
      await shareFile(filePath)
    },

    listLibraryFolders: (lib) => call('fs:listLibraryFolders', lib),
    createLibraryFolder: (lib, name) => call('fs:createLibraryFolder', lib, name),
    renameLibraryFolder: (lib, oldName, newName) => call('fs:renameLibraryFolder', lib, oldName, newName),
    deleteLibraryFolder: (lib, name) => call('fs:deleteLibraryFolder', lib, name),
    renameLibraryFile: (filePath, newName) => call('fs:renameLibraryFile', filePath, newName),
    getFileLog: (filePath) => call('fileinfo:getLog', filePath),
    logFileEvent: (filePath, type, summary) => call('fileinfo:logEvent', filePath, type, summary),
    listFileVersions: (filePath) => call('fileinfo:listVersions', filePath),
    moveLibraryFiles: (paths, lib, dest) => call('fs:moveLibraryFiles', paths, lib, dest),

    listSoundfonts: async () => {
      const onDisk = await vfs.listLargeFiles(SOUNDFONTS)
      const names = new Set(onDisk.map(f => f.name))
      const known = new Set(Object.values(SOUNDFONT_CATALOG).map(e => e.filename))
      return [
        ...Object.entries(SOUNDFONT_CATALOG).map(([id, e]) => ({ id, name: e.name, sizeMB: e.sizeMB, downloaded: names.has(e.filename), custom: false })),
        ...onDisk.filter(f => /\.(sf2|sf3)$/i.test(f.name) && !known.has(f.name)).map(f => ({
          id: `${CUSTOM_SF_PREFIX}${f.name}`, name: f.name.replace(/\.(sf2|sf3)$/i, ''),
          sizeMB: Math.round((f.size / (1024 * 1024)) * 10) / 10, downloaded: true, custom: true,
        })),
      ]
    },
    downloadSoundfont: async (id) => {
      const entry = SOUNDFONT_CATALOG[id]
      if (!entry) return { ok: false, error: 'Unknown soundfont' }
      if (!Capacitor.isNativePlatform()) return { ok: false, error: 'Downloads need the iPad app.' }
      const handle = await Filesystem.addListener('progress', (p) => {
        if (p.url === entry.url && p.contentLength > 0) soundfontProgress?.({ id, progress: p.bytes / p.contentLength })
      })
      try {
        await Filesystem.downloadFile({ url: entry.url, path: `soundfonts/${entry.filename}`, directory: Directory.Data, recursive: true, progress: true })
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e?.message ?? 'Download failed' }
      } finally {
        await handle.remove()
      }
    },
    deleteSoundfont: async (id) => { const p = soundfontPath(id); if (p) await vfs.deleteLargeFile(p) },
    readSoundfont: async (id) => { const p = soundfontPath(id); return p ? readSoundfontBytes(p) : null },
    importSoundfont: async () => {
      const [file] = await pickFiles()
      if (!file || !/\.(sf2|sf3)$/i.test(file.name)) return null
      const existing = new Set((await vfs.listLargeFiles(SOUNDFONTS)).map(f => f.name))
      const ext = extname(file.name), stem = file.name.slice(0, -ext.length)
      let name = file.name
      for (let n = 2; existing.has(name); n++) name = `${stem} (${n})${ext}`
      await vfs.writeLargeFile(join(SOUNDFONTS, name), await fileBytes(file))
      return `${CUSTOM_SF_PREFIX}${name}`
    },
    onSoundfontProgress: (fn) => { soundfontProgress = fn },
    offSoundfontProgress: () => { soundfontProgress = null },

    getPathForFile: (file) => {
      const p = freePath(INBOX, file.name)
      pendingInbox.set(p, fileBytes(file).then(bytes => { vfs.writeFileSync(p, bytes) }))
      return p
    },
    copyMidiToLibrary: async (sourcePath, libraryFolder) => {
      await waitInbox(sourcePath)
      const dest = await call('fs:copyMidiToLibrary', sourcePath, libraryFolder)
      if (sourcePath.startsWith(INBOX + '/')) vfs.unlinkSync(sourcePath)
      return dest
    },
    getCachedImport: async (sourcePath: string, cachePath: string) => { await waitInbox(sourcePath); return call('fs:getCachedImport', sourcePath, cachePath) },
    writeCachedImport: (destPath: string, base64: string) => call('fs:writeCachedImport', destPath, base64),

    // Updates come from the App Store / TestFlight
    getUpdateInfo: async () => ({ mode: 'manual', downloadUrl: 'https://github.com/HOAI-droid/Pianooo/releases/tag/ipad-latest' }),
    checkForUpdates: async () => { await Browser.open({ url: 'https://github.com/HOAI-droid/Pianooo/releases/tag/ipad-latest' }) },
    installUpdate: async () => {},
    onUpdateStatus: () => {},
    offUpdateStatus: () => {},

    getSupportNoteInfo: async () => ({ store: false, prompt: false }),
    requestReview: async () => 'canceled',
    neverShowSupportNote: async () => {},
    snoozeSupportNote: async () => {},

    getZoom: async () => ({ percent: loadPrefs().ipadZoom ?? 100, steps: ZOOM_STEPS, max: ZOOM_STEPS[ZOOM_STEPS.length - 1] }),
    setZoom: async (percent) => {
      const p = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], percent))
      applyZoom(p)
      savePrefs({ ipadZoom: p })
      const data = { percent: p, capped: p !== percent }
      zoomListeners.forEach(fn => fn(data))
      return data
    },
    onZoomChanged: (fn) => { zoomListeners.add(fn) },
    offZoomChanged: (fn) => { zoomListeners.delete(fn) },
    takePendingOpenFiles,
    // Sheet music (iPad only — see components/SheetView)
    findSheet: async (midiPath: string) => findSheet(midiPath) ?? (await vfs.refresh(DOCUMENTS), findSheet(midiPath)),
    sheetUrl: (path: string) => vfs.nativeUrl(path),
    readSheet: (path: string) => vfs.readFileAsync(path),
    printSheet: (path: string) => printFile(path),
    shareSheet: (path: string) => shareFile(path),
  } as Window['electronAPI']
}

// ── Files opened from other apps (Safari download, Files, AirDrop) ──────────
// The native side (ios/App/App/PianoooFilesPlugin.swift) has already copied
// the file into the library; App.tsx listens for 'pianooo:open-file' and
// opens it. A file that opened the app arrives before App.tsx listens — it
// stays queued natively and App.tsx collects it with takePendingOpenFiles().
interface PianoooFilesPlugin {
  takePending(): Promise<{ paths: string[] }>
  addListener(event: 'fileOpened', fn: (e: { path: string }) => void): Promise<{ remove(): Promise<void> }>
}
const PianoooFiles = registerPlugin<PianoooFilesPlugin>('PianoooFiles')
let openListenerReady = false
async function takePendingOpenFiles(): Promise<string[]> {
  openListenerReady = true
  if (!Capacitor.isPluginAvailable('PianoooFiles')) return []
  try { return (await PianoooFiles.takePending()).paths } catch { return [] }
}
function listenForOpenedFiles() {
  if (!Capacitor.isPluginAvailable('PianoooFiles')) return
  void PianoooFiles.addListener('fileOpened', ({ path }) => {
    if (!openListenerReady) return // collected later via takePendingOpenFiles
    void PianoooFiles.takePending().catch(() => {}) // handled here — clear the queue
    window.dispatchEvent(new CustomEvent('pianooo:open-file', { detail: path }))
  })
}

/** Loads the iPad's files and installs window.electronAPI. Call before the app renders. */
export async function installIpadBridge(): Promise<void> {
  await vfs.init()
  if (!loadPrefs().libraryFolder) savePrefs({ libraryFolder: LIBRARY })
  await seedDemos()
  const zoom = loadPrefs().ipadZoom
  if (typeof zoom === 'number' && zoom !== 100) applyZoom(zoom)
  window.electronAPI = createApi()
  listenForOpenedFiles()
}
