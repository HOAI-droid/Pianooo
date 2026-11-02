// ── iPad file system ─────────────────────────────────────────────────────────
// The desktop app's Electron main process works with Node's synchronous fs.
// On iPad, files live in the app's sandbox (Capacitor Filesystem, async only).
// This module keeps an in-memory copy of the app's files and offers the small
// slice of Node's fs API the ported handlers use. Every change is applied to
// memory at once and written to disk in the background, in order.
//
// Virtual roots:
//   /Documents  → the app's Documents folder (visible in the iPad Files app)
//   /Data       → private app data (prefs, file log)
// MIDI files are small, so holding the library in memory is cheap. Large files
// (soundfonts) are never mirrored — see BIG_FILE_BYTES.

import { Filesystem, Directory } from '@capacitor/filesystem'
import { join, dirname, basename } from './path'

export const DOCUMENTS = '/Documents'
export const DATA = '/Data'
const BIG_FILE_BYTES = 16 * 1024 * 1024
const NOT_MIRRORED = [`${DATA}/soundfonts`]

// ── base64 / text helpers ────────────────────────────────────────────────────
export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return btoa(s)
}
export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/^data:[^,]*,/, ''))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ── Node-style Buffer: a Uint8Array whose toString() can do base64/utf-8 ─────
export class NodeBuffer extends Uint8Array {
  toString(encoding?: string): string {
    if (encoding === 'base64') return bytesToBase64(this)
    return new TextDecoder().decode(this)
  }
}
function makeBuffer(bytes: ArrayLike<number>): NodeBuffer {
  const b = new NodeBuffer(bytes.length)
  b.set(bytes)
  return b
}
export const Buffer = {
  from(data: string | ArrayLike<number> | ArrayBuffer, encoding?: string): NodeBuffer {
    if (typeof data === 'string') return makeBuffer(encoding === 'base64' ? base64ToBytes(data) : new TextEncoder().encode(data))
    if (data instanceof ArrayBuffer) return makeBuffer(new Uint8Array(data))
    return makeBuffer(data)
  },
}

// ── State ────────────────────────────────────────────────────────────────────
interface Entry { data: Uint8Array; mtime: number; diskMtime?: number }
const files = new Map<string, Entry>()
const dirs = new Set<string>(['/', DOCUMENTS, DATA])

let queue: Promise<unknown> = Promise.resolve()
function persist(op: () => Promise<unknown>) {
  queue = queue.then(op).catch(e => console.warn('[Orfeo iPad] disk write failed:', e))
}
/** Resolves once every pending disk write has finished. */
export function flush(): Promise<unknown> { return queue }

function norm(p: string): string { return join('/', p) }

function toNative(p: string): { directory: Directory; path: string } {
  const n = norm(p)
  if (n === DOCUMENTS || n.startsWith(DOCUMENTS + '/')) return { directory: Directory.Documents, path: n.slice(DOCUMENTS.length + 1) }
  if (n === DATA || n.startsWith(DATA + '/')) return { directory: Directory.Data, path: n.slice(DATA.length + 1) }
  throw fsError('EACCES', `outside app storage: ${p}`)
}

function fsError(code: string, message: string): Error {
  const e = new Error(`${code}: ${message}`) as Error & { code: string }
  e.code = code
  return e
}

function ensureDirChain(dir: string) {
  let d = norm(dir)
  const chain: string[] = []
  while (!dirs.has(d)) { chain.push(d); d = dirname(d) }
  for (const c of chain) dirs.add(c)
}

function toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data)
}

async function readNative(p: string): Promise<Uint8Array> {
  const res = await Filesystem.readFile(toNative(p))
  if (typeof res.data === 'string') return base64ToBytes(res.data)
  return new Uint8Array(await (res.data as Blob).arrayBuffer())
}

function persistWrite(p: string, bytes: Uint8Array) {
  persist(async () => {
    await Filesystem.writeFile({ ...toNative(p), data: bytesToBase64(bytes), recursive: true })
    const entry = files.get(p)
    if (entry && entry.data === bytes) {
      try { entry.diskMtime = (await Filesystem.stat(toNative(p))).mtime } catch {}
    }
  })
}

// ── Loading from disk ────────────────────────────────────────────────────────
async function scanInto(dir: string, seen: Set<string>) {
  if (NOT_MIRRORED.includes(dir)) return
  let entries
  try { entries = (await Filesystem.readdir(toNative(dir))).files } catch { return }
  dirs.add(dir)
  seen.add(dir)
  for (const f of entries) {
    const p = join(dir, f.name)
    if (f.type === 'directory') { await scanInto(p, seen); continue }
    if (f.size > BIG_FILE_BYTES) continue
    seen.add(p)
    const known = files.get(p)
    if (known && known.diskMtime === f.mtime && known.data.length === f.size) continue
    try { files.set(p, { data: await readNative(p), mtime: f.mtime, diskMtime: f.mtime }) } catch {}
  }
}

/**
 * Re-reads a folder tree from disk so files added or removed outside the app
 * (e.g. in the Files app) show up. Waits for pending writes first.
 */
export async function refresh(dir: string = DOCUMENTS): Promise<void> {
  await flush()
  const root = norm(dir)
  const seen = new Set<string>()
  await scanInto(root, seen)
  for (const p of [...files.keys()]) if ((p === root || p.startsWith(root + '/')) && !seen.has(p)) files.delete(p)
  for (const d of [...dirs]) if (d.startsWith(root + '/') && !seen.has(d)) dirs.delete(d)
}

export async function init(): Promise<void> {
  await refresh(DOCUMENTS)
  await refresh(DATA)
}

// ── fs (sync) ────────────────────────────────────────────────────────────────
export function existsSync(p: string): boolean {
  const n = norm(p)
  return files.has(n) || dirs.has(n)
}

export function readFileSync(p: string): NodeBuffer
export function readFileSync(p: string, encoding: string): string
export function readFileSync(p: string, encoding?: string): NodeBuffer | string {
  const e = files.get(norm(p))
  if (!e) throw fsError('ENOENT', `no such file: ${p}`)
  const buf = makeBuffer(e.data)
  return encoding ? buf.toString(encoding) : buf
}

export function writeFileSync(p: string, data: string | Uint8Array | ArrayBuffer) {
  const n = norm(p)
  ensureDirChain(dirname(n))
  const bytes = toBytes(data)
  files.set(n, { data: bytes, mtime: Date.now() })
  persistWrite(n, bytes)
}

export function unlinkSync(p: string) {
  const n = norm(p)
  if (!files.delete(n)) throw fsError('ENOENT', `no such file: ${p}`)
  persist(() => Filesystem.deleteFile(toNative(n)))
}

export interface Dirent { name: string; isFile(): boolean; isDirectory(): boolean }

function children(dir: string): Dirent[] {
  const n = norm(dir)
  if (!dirs.has(n)) throw fsError('ENOENT', `no such folder: ${dir}`)
  const out = new Map<string, Dirent>()
  const prefix = n === '/' ? '/' : n + '/'
  for (const d of dirs) {
    if (d.startsWith(prefix) && d !== n && !d.slice(prefix.length).includes('/')) {
      const name = d.slice(prefix.length)
      out.set(name, { name, isFile: () => false, isDirectory: () => true })
    }
  }
  for (const f of files.keys()) {
    if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) {
      const name = f.slice(prefix.length)
      out.set(name, { name, isFile: () => true, isDirectory: () => false })
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function readdirSync(dir: string): string[]
export function readdirSync(dir: string, opts: { withFileTypes: true }): Dirent[]
export function readdirSync(dir: string, opts?: { withFileTypes?: boolean }): string[] | Dirent[] {
  const list = children(dir)
  return opts?.withFileTypes ? list : list.map(d => d.name)
}

export function statSync(p: string) {
  const n = norm(p)
  const e = files.get(n)
  if (e) return { size: e.data.length, mtimeMs: e.mtime, isFile: () => true, isDirectory: () => false }
  if (dirs.has(n)) return { size: 0, mtimeMs: 0, isFile: () => false, isDirectory: () => true }
  throw fsError('ENOENT', `no such file: ${p}`)
}

// ── fs/promises ──────────────────────────────────────────────────────────────
export async function mkdir(p: string, _opts?: { recursive?: boolean }): Promise<void> {
  const n = norm(p)
  if (dirs.has(n)) return
  ensureDirChain(n)
  persist(() => Filesystem.mkdir({ ...toNative(n), recursive: true }).catch(() => {}))
}

export async function access(p: string): Promise<void> {
  if (!existsSync(p)) throw fsError('ENOENT', `no such file: ${p}`)
}

export async function readdir(dir: string): Promise<string[]>
export async function readdir(dir: string, opts: { withFileTypes: true }): Promise<Dirent[]>
export async function readdir(dir: string, opts?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
  return opts?.withFileTypes ? readdirSync(dir, { withFileTypes: true }) : readdirSync(dir)
}

export async function readFile(p: string): Promise<NodeBuffer> { return readFileSync(p) }

export async function writeFile(p: string, data: string | Uint8Array | ArrayBuffer, opts?: { flag?: string }): Promise<void> {
  if (opts?.flag === 'wx' && existsSync(p)) throw fsError('EEXIST', `file exists: ${p}`)
  writeFileSync(p, data)
}

export async function copyFile(src: string, dest: string): Promise<void> {
  writeFileSync(dest, new Uint8Array(readFileSync(src)))
}

export async function rename(from: string, to: string): Promise<void> {
  const a = norm(from), b = norm(to)
  if (files.has(a)) {
    const e = files.get(a)!
    files.delete(a)
    ensureDirChain(dirname(b))
    files.set(b, { ...e, mtime: Date.now(), diskMtime: undefined })
  } else if (dirs.has(a)) {
    ensureDirChain(dirname(b))
    for (const d of [...dirs]) if (d === a || d.startsWith(a + '/')) { dirs.delete(d); dirs.add(b + d.slice(a.length)) }
    for (const [f, e] of [...files]) if (f.startsWith(a + '/')) { files.delete(f); files.set(b + f.slice(a.length), { ...e, diskMtime: undefined }) }
  } else {
    throw fsError('ENOENT', `no such file: ${from}`)
  }
  persist(() => Filesystem.rename({ from: toNative(a).path, to: toNative(b).path, directory: toNative(a).directory, toDirectory: toNative(b).directory }))
}

export async function rmdir(p: string): Promise<void> {
  const n = norm(p)
  if (!dirs.has(n)) throw fsError('ENOENT', `no such folder: ${p}`)
  if (children(n).length > 0) throw fsError('ENOTEMPTY', `folder not empty: ${p}`)
  dirs.delete(n)
  persist(() => Filesystem.rmdir(toNative(n)))
}

// ── Large files (soundfonts) — straight to disk, never held in memory ────────
export async function writeLargeFile(p: string, bytes: Uint8Array): Promise<void> {
  await flush()
  await Filesystem.writeFile({ ...toNative(p), data: bytesToBase64(bytes), recursive: true })
}
export async function readLargeFile(p: string): Promise<Uint8Array | null> {
  try { return await readNative(p) } catch { return null }
}
export async function listLargeFiles(dir: string): Promise<{ name: string; size: number }[]> {
  try { return (await Filesystem.readdir(toNative(dir))).files.filter(f => f.type === 'file').map(f => ({ name: f.name, size: f.size })) }
  catch { return [] }
}
export async function deleteLargeFile(p: string): Promise<void> {
  try { await Filesystem.deleteFile(toNative(p)) } catch {}
}

export { basename }
