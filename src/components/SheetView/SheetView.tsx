// ── Sheet music view (iPad) ──────────────────────────────────────────────────
// Shows the song's sheet music — a PDF with the same name next to the MIDI
// file — in place of the falling notes. One or the other, never squeezed
// together: the toggle (ViewToggle) switches the whole area. The piano roll
// stays mounted underneath, so playback, keyboard lights and MIDI input carry
// on exactly as before. Pages turn by scrolling, the ‹ › buttons, tapping the
// left/right edge, or a page-turner pedal (Page Up / Page Down).
//
// Only active where the platform can find sheet music (the iPad bridge's
// findSheet); the desktop build never shows the toggle.

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { ChevronLeft, ChevronRight, Minus, Plus, Printer, Share2, Music, FileText } from 'lucide-react'
import { useStore } from '../../store'
import { t } from '../../utils/i18n'

type SheetApi = {
  findSheet: (midiPath: string) => Promise<string | null>
  sheetUrl: (path: string) => Promise<string | null>
  readSheet: (path: string) => Promise<Uint8Array>
  printSheet: (path: string) => Promise<boolean>
  shareSheet: (path: string) => Promise<void>
}
const api = (): SheetApi | null => {
  const a = window.electronAPI as unknown as Partial<SheetApi> | undefined
  return a?.findSheet ? (a as SheetApi) : null
}
export const sheetSupported = () => api() !== null

// ── Which view is showing — remembered between sessions ──────────────────────
type Mode = 'roll' | 'sheet'
const MODE_KEY = 'pianooo.view'
function savedMode(): Mode { try { return localStorage.getItem(MODE_KEY) === 'sheet' ? 'sheet' : 'roll' } catch { return 'roll' } }
export const useSheetMode = create<{ mode: Mode; setMode: (m: Mode) => void }>((set) => ({
  mode: savedMode(),
  setMode: (mode) => { set({ mode }); try { localStorage.setItem(MODE_KEY, mode) } catch {} },
}))

/** Path of the open song's sheet music, or null */
export function useSheetPath(): string | null {
  const midi = useStore((s) => s.midi)
  const [path, setPath] = useState<string | null>(null)
  useEffect(() => {
    const a = api()
    const midiPath = (midi as any)?._filePath as string | undefined
    if (!a || !midiPath) { setPath(null); return }
    let alive = true
    a.findSheet(midiPath).then(p => { if (alive) setPath(p) }).catch(() => { if (alive) setPath(null) })
    return () => { alive = false }
  }, [midi])
  return path
}

// ── Toggle: Falling notes | Sheet music ──────────────────────────────────────
export function ViewToggle({ hasSheet }: { hasSheet: boolean }) {
  const mode = useSheetMode((s) => s.mode)
  const setMode = useSheetMode((s) => s.setMode)
  const shown: Mode = hasSheet ? mode : 'roll'
  const btn = (m: Mode, label: string, icon: React.ReactNode, disabled = false) => (
    <button
      onClick={() => { if (!disabled) setMode(m) }}
      disabled={disabled}
      aria-pressed={shown === m}
      title={disabled ? t`No sheet music for this song — put a PDF with the same name next to it` : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 7, border: 'none',
        background: shown === m ? 'var(--text-amber)' : 'transparent',
        color: shown === m ? '#1a1305' : disabled ? 'var(--text-inactive)' : 'var(--text-muted)',
        fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >{icon}{label}</button>
  )
  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, zIndex: 20, display: 'flex', gap: 2, padding: 2,
      background: 'var(--bg-modal-header)', border: '1px solid var(--border)', borderRadius: 9,
      boxShadow: '0 4px 14px rgba(0,0,0,.35)',
    }}>
      {btn('roll', t`Falling notes`, <Music size={14} />)}
      {btn('sheet', t`Sheet music`, <FileText size={14} />, !hasSheet)}
    </div>
  )
}

// ── The sheet itself ─────────────────────────────────────────────────────────
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; loadingTask?: { destroy: () => Promise<void> } }

// Releases a document and its worker. Never throws: this runs while React
// unmounts the view, and an exception there would take the whole app down.
function closePdf(d: PdfDoc | null) {
  try { void d?.loadingTask?.destroy().catch(() => {}) } catch {}
}

async function loadPdf(path: string): Promise<PdfDoc> {
  const a = api()!
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const url = await a.sheetUrl(path)
  const data = url ? new Uint8Array(await (await fetch(url)).arrayBuffer()) : await a.readSheet(path)
  return pdfjs.getDocument({ data }).promise
}

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5]

export default function SheetView({ path }: { path: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(() => { try { return Number(localStorage.getItem('pianooo.sheetZoom')) || 1 } catch { return 1 } })
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<'print' | 'share' | null>(null)

  // Load the PDF
  useEffect(() => {
    let alive = true
    let loaded: PdfDoc | null = null
    setDoc(null); setError(null); setPage(1)
    loadPdf(path)
      .then(d => { loaded = d; if (alive) setDoc(d); else closePdf(d) })
      .catch(e => { console.error('[Pianooo] sheet music failed to load:', e); if (alive) setError(t`This sheet music could not be opened.`) })
    return () => { alive = false; closePdf(loaded) }
  }, [path])

  // Follow the available width
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Pages: one placeholder per page at its final size. Only pages on or near
  // the screen are drawn — one at a time, the visible one first — and pages
  // far off screen give their drawing surface back. Keeping every page as a
  // full-resolution canvas used hundreds of MB of graphics memory, enough to
  // take the falling-notes view (WebGL) down with it.
  useEffect(() => {
    const host = pagesRef.current
    const scroller = scrollRef.current
    if (!doc || !host || !scroller || width < 50) return
    let cancelled = false
    const drawn = new Map<number, HTMLCanvasElement>()
    const wanted = new Set<number>()
    let current: { n: number; cancel: () => void } | null = null
    let io: IntersectionObserver | null = null
    let farIo: IntersectionObserver | null = null
    const slots: HTMLElement[] = []
    const scales: number[] = []

    // Closest to the middle of the screen first
    const nextPage = (): number | null => {
      const mid = scroller.scrollTop + scroller.clientHeight / 2
      let best: number | null = null, bestDist = Infinity
      for (const n of wanted) {
        const slot = slots[n - 1]
        const d = Math.abs(slot.offsetTop + slot.offsetHeight / 2 - mid)
        if (d < bestDist) { best = n; bestDist = d }
      }
      return best
    }

    const pump = async () => {
      if (current || cancelled) return
      const n = nextPage()
      if (n === null) return
      wanted.delete(n)
      if (drawn.has(n)) { void pump(); return }
      try {
        const p = await doc.getPage(n)
        if (cancelled) return
        // Sharp, but bounded: at most 2× and at most 2200 px wide
        const cssW = p.getViewport({ scale: scales[n - 1] }).width
        const ratio = Math.min(window.devicePixelRatio || 1, 2, 2200 / cssW)
        const vp = p.getViewport({ scale: scales[n - 1] * ratio })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        canvas.style.cssText = 'width:100%;height:100%;display:block;border-radius:4px'
        const task = p.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas })
        current = { n, cancel: () => task.cancel() }
        await task.promise
        if (cancelled) { canvas.width = 0; return }
        drawn.set(n, canvas)
        slots[n - 1].replaceChildren(canvas)
      } catch (e) {
        if (!cancelled && (e as any)?.name !== 'RenderingCancelledException') console.warn('[Pianooo] page render failed:', n, e)
      } finally {
        current = null
      }
      if (!cancelled) void pump()
    }

    const release = (n: number) => {
      wanted.delete(n)
      if (current?.n === n) current.cancel()
      const c = drawn.get(n)
      if (!c) return
      c.width = 0; c.height = 0 // hand the memory back right away
      slots[n - 1].replaceChildren()
      drawn.delete(n)
    }

    const timer = setTimeout(async () => {
      const target = Math.min(width - 32, 1400) * zoom
      // Size every placeholder like page 1 (sheet music is one paper size);
      // asking each page first would hold up the first picture
      const base = (await doc.getPage(1)).getViewport({ scale: 1 })
      if (cancelled) return
      for (let n = 1; n <= doc.numPages; n++) {
        const scale = target / base.width
        const slot = document.createElement('div')
        slot.dataset.page = String(n)
        slot.style.cssText = `width:${Math.floor(base.width * scale)}px;height:${Math.floor(base.height * scale)}px;` +
          'margin:0 auto 16px;background:#fff;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.35)'
        slots.push(slot); scales.push(scale)
      }
      if (cancelled) return
      host.replaceChildren(...slots)
      // Draw what is within half a screen of the visible area…
      io = new IntersectionObserver(entries => {
        for (const e of entries) if (e.isIntersecting) wanted.add(Number((e.target as HTMLElement).dataset.page))
        void pump()
      }, { root: scroller, rootMargin: '50% 0px' })
      // …and let go of what is more than two screens away
      farIo = new IntersectionObserver(entries => {
        for (const e of entries) if (!e.isIntersecting) release(Number((e.target as HTMLElement).dataset.page))
      }, { root: scroller, rootMargin: '200% 0px' })
      for (const sl of slots) { io.observe(sl); farIo.observe(sl) }
    }, 80)

    return () => {
      cancelled = true
      clearTimeout(timer)
      io?.disconnect(); farIo?.disconnect()
      current?.cancel()
      for (const c of drawn.values()) { c.width = 0; c.height = 0 }
      host.replaceChildren()
    }
  }, [doc, width, zoom])

  // Page number from the scroll position
  const onScroll = () => {
    const el = scrollRef.current, host = pagesRef.current
    if (!el || !host) return
    const mid = el.scrollTop + el.clientHeight * 0.35
    let current = 1
    for (const c of Array.from(host.children) as HTMLElement[]) if (c.offsetTop <= mid) current = Number(c.dataset.page)
    setPage(current)
  }

  const goTo = (n: number) => {
    const el = scrollRef.current, host = pagesRef.current
    if (!el || !host || !doc) return
    const target = host.children[Math.max(0, Math.min(doc.numPages, n) - 1)] as HTMLElement | undefined
    if (target) el.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' })
  }
  // Forward/back by one screen, landing on the next page top when it's close
  const turn = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ top: dir * (el.clientHeight - 60), behavior: 'smooth' })
  }

  // Page-turner pedals and keyboards: Page Up / Page Down
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PageDown') { e.preventDefault(); turn(1) }
      else if (e.key === 'PageUp') { e.preventDefault(); turn(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setZoomStep = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex(z => z >= zoom - 1e-6)
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 3 : i) + dir))]
    setZoom(next)
    try { localStorage.setItem('pianooo.sheetZoom', String(next)) } catch {}
  }

  const doPrint = async () => { setBusy('print'); try { await api()?.printSheet(path) } finally { setBusy(null) } }
  const doShare = async () => { setBusy('share'); try { await api()?.shareSheet(path) } finally { setBusy(null) } }

  // Tap the left/right fifth of the page area to turn
  const onTap = (e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    if (x < 0.18) turn(-1)
    else if (x > 0.82) turn(1)
  }

  // Narrow (library drawer open): icon-only buttons, so the toolbar fits beside the view toggle
  const compact = width > 0 && width < 860

  const tool: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 36, height: 34, padding: '0 10px',
    borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-tile)', color: 'var(--text-default)',
    fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 15, display: 'flex', flexDirection: 'column', background: 'var(--bg-modal-header)' }}>
      {/* Toolbar — leaves room on the right for the view toggle */}
      <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', paddingRight: compact ? 250 : 290, borderBottom: '1px solid var(--border)' }}>
        <button style={tool} onClick={() => goTo(page - 1)} aria-label={t`Previous page`}><ChevronLeft size={16} /></button>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-default)', minWidth: 86, textAlign: 'center' }}>
          {doc ? <>{t`Page`} <b>{page}</b> / {doc.numPages}</> : '…'}
        </span>
        <button style={tool} onClick={() => goTo(page + 1)} aria-label={t`Next page`}><ChevronRight size={16} /></button>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <button style={tool} onClick={() => setZoomStep(-1)} aria-label={t`Smaller`}><Minus size={16} /></button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button style={tool} onClick={() => setZoomStep(1)} aria-label={t`Larger`}><Plus size={16} /></button>
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <button style={tool} onClick={doPrint} disabled={busy !== null} aria-label={t`Print`}><Printer size={15} />{!compact && t`Print`}</button>
        <button style={tool} onClick={doShare} disabled={busy !== null} aria-label={t`Share`}><Share2 size={15} />{!compact && t`Share`}</button>
      </div>

      <div ref={scrollRef} onScroll={onScroll} onClick={onTap}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: zoom > 1 ? 'auto' : 'hidden', padding: '16px 16px 24px', WebkitOverflowScrolling: 'touch' as any }}>
        {error
          ? <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 14, textAlign: 'center', marginTop: 60 }}>{error}</div>
          : <>
              {!doc && <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 13, textAlign: 'center', marginTop: 60 }}>{t`Loading sheet music…`}</div>}
              {/* filled with page canvases outside React — keep it childless here */}
              <div ref={pagesRef} />
            </>}
      </div>
    </div>
  )
}
