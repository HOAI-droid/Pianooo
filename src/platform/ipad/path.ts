// Minimal POSIX path helpers for the iPad build (stands in for Node's 'path').
// All iPad paths are virtual and absolute, e.g. /Documents/Demo/song.mid.

function normalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return (abs ? '/' : '') + out.join('/')
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'))
}

export function basename(p: string, ext?: string): string {
  const name = normalize(p).split('/').pop() ?? ''
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name
}

export function dirname(p: string): string {
  const n = normalize(p)
  const i = n.lastIndexOf('/')
  if (i <= 0) return n.startsWith('/') ? '/' : '.'
  return n.slice(0, i)
}

export function extname(p: string): string {
  const name = basename(p)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i) : ''
}

export const sep = '/'
export default { join, basename, dirname, extname, sep }
