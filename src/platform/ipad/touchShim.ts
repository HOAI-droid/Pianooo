// ── Touch → mouse ────────────────────────────────────────────────────────────
// Orfeo's UI is written for a mouse (onMouseDown / onMouseEnter / window
// mousemove listeners). iPadOS only fakes mouse events for simple taps, so
// drags (sliders, knobs, loop region, note editor, glissando) would not work.
// This turns touches into the mouse events the app expects:
//   • every finger that lands sends mousedown on what it touched, so several
//     fingers on the on-screen keyboard play a chord
//   • the first finger drives mousemove / mouseover / mouseout (drags, glissando)
//   • lifting sends mouseup (+ click for a tap)
//   • holding still for a moment sends contextmenu (the desktop right-click)
// Touches that start in a scrollable list or a text field are left to iPadOS,
// so native scrolling and typing keep working.

const LONG_PRESS_MS = 550
const MOVE_TOLERANCE = 10

interface Tracked {
  id: number
  startX: number
  startY: number
  target: Element
  over: Element
  moved: boolean
  longPressed: boolean
  timer: number | undefined
}

const tracked = new Map<number, Tracked>()
let primaryId: number | null = null

function isNativeTarget(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement) return true
    if ((n as HTMLElement).isContentEditable) return true
    const style = getComputedStyle(n)
    const scrollY = /(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 1
    const scrollX = /(auto|scroll)/.test(style.overflowX) && n.scrollWidth > n.clientWidth + 1
    if (scrollY || scrollX) return true
  }
  return false
}

function fire(type: string, target: Element, t: Touch, extra: MouseEventInit = {}) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: t.clientX,
    clientY: t.clientY,
    screenX: t.screenX,
    screenY: t.screenY,
    button: 0,
    buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
    detail: type === 'click' ? 1 : 0,
    ...extra,
  })
  return target.dispatchEvent(ev)
}

function onTouchStart(e: TouchEvent) {
  for (const t of Array.from(e.changedTouches)) {
    const target = (t.target as Element) ?? document.elementFromPoint(t.clientX, t.clientY)
    if (!target || isNativeTarget(target)) continue
    e.preventDefault()
    const rec: Tracked = {
      id: t.identifier, startX: t.clientX, startY: t.clientY,
      target, over: target, moved: false, longPressed: false, timer: undefined,
    }
    tracked.set(t.identifier, rec)
    if (primaryId === null) primaryId = t.identifier
    fire('mouseover', target, t)
    fire('mousemove', target, t)
    fire('mousedown', target, t)
    rec.timer = window.setTimeout(() => {
      if (rec.moved) return
      rec.longPressed = true
      fire('contextmenu', rec.over, t, { button: 2, buttons: 2 })
    }, LONG_PRESS_MS)
  }
}

function onTouchMove(e: TouchEvent) {
  for (const t of Array.from(e.changedTouches)) {
    const rec = tracked.get(t.identifier)
    if (!rec) continue
    e.preventDefault()
    if (Math.hypot(t.clientX - rec.startX, t.clientY - rec.startY) > MOVE_TOLERANCE) {
      rec.moved = true
      clearTimeout(rec.timer)
    }
    const el = document.elementFromPoint(t.clientX, t.clientY) ?? rec.over
    if (el !== rec.over) {
      fire('mouseout', rec.over, t, { relatedTarget: el })
      fire('mouseover', el, t, { relatedTarget: rec.over })
      rec.over = el
    }
    if (t.identifier === primaryId) fire('mousemove', el, t)
  }
}

function onTouchEnd(e: TouchEvent) {
  for (const t of Array.from(e.changedTouches)) {
    const rec = tracked.get(t.identifier)
    if (!rec) continue
    e.preventDefault()
    clearTimeout(rec.timer)
    tracked.delete(t.identifier)
    const el = document.elementFromPoint(t.clientX, t.clientY) ?? rec.over
    fire('mouseup', el, t)
    if (e.type === 'touchend' && !rec.moved && !rec.longPressed) {
      fire('click', rec.target, t)
      focusIfFocusable(rec.target)
    }
    fire('mouseout', el, t)
    if (t.identifier === primaryId) primaryId = tracked.size ? tracked.keys().next().value ?? null : null
  }
}

function focusIfFocusable(el: Element) {
  const f = el.closest('button, a, [tabindex], label') as HTMLElement | null
  if (f && document.activeElement !== f) f.focus({ preventScroll: true })
}

export function installTouchShim() {
  const opts = { passive: false, capture: true }
  document.addEventListener('touchstart', onTouchStart, opts)
  document.addEventListener('touchmove', onTouchMove, opts)
  document.addEventListener('touchend', onTouchEnd, opts)
  document.addEventListener('touchcancel', onTouchEnd, opts)
}
