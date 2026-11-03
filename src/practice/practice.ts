// ── Practice modes ──────────────────────────────────────────────────────────
// Two ways to practise a song with your own keyboard:
//
//   'wait'   — the notes fall to the line and stop there until you press the
//              right key (all keys of a chord). Learn the notes first.
//   'rhythm' — the song runs in tempo and every note you play is judged:
//              on time, early, late, wrong or missed. Build up speed.
//
// You choose the hand you practise (left, right or both); the app can play
// everything else (the other hand and other instruments) along with you.
// With "speed up automatically", every pass with at least 90 % accuracy
// raises the tempo by 5 % until the song's own tempo is reached.
//
// The practice run has its own clock instead of the normal playback engines:
// it moves the playhead itself and plays the accompaniment note by note
// (window.__orfeoPlayNote, the same path Step Through uses), so it works the
// same with every sound engine and can stop on any note. The store's
// playbackState stays 'paused' meanwhile, which keeps the engines silent.

import { create } from 'zustand'
import { useStore } from '../store'
import { NES } from '../utils/noteEditorState'
import { pushHitEffect } from '../utils/hitEffectQueue'
import { handHex } from '../utils/handPalette'
import { isShown } from '../utils/trackShown'
import type { Hand } from '../types'

export type PracticeMode = 'off' | 'wait' | 'rhythm'
export type PracticeHand = 'L' | 'R' | 'both'
export type Judgement = 'perfect' | 'early' | 'late' | 'wrong' | 'miss' | 'hit'

export interface PracticeStats {
  correct: number   // right notes (wait) / notes hit within the window (rhythm)
  wrong: number     // keys that matched nothing
  missed: number    // rhythm: notes that passed without being played
  perfect: number   // rhythm: within ±80 ms
  early: number
  late: number
  streak: number
  bestStreak: number
}

export interface PassSummary {
  mode: Exclude<PracticeMode, 'off'>
  accuracy: number          // 0..1
  stats: PracticeStats
  tempoFrom: number         // % of the song's tempo
  tempoTo: number
  finished: boolean         // true at the end of the song, false after a loop pass
}

interface Settings {
  mode: PracticeMode
  hand: PracticeHand
  accompany: boolean
  autoTempo: boolean
}

interface PracticeState extends Settings {
  running: boolean
  waiting: boolean
  countdown: number | null
  stats: PracticeStats
  summary: PassSummary | null
  judgement: { kind: Judgement; at: number } | null
  setMode: (m: PracticeMode) => void
  setHand: (h: PracticeHand) => void
  setAccompany: (v: boolean) => void
  setAutoTempo: (v: boolean) => void
  dismissSummary: () => void
}

const KEY = 'pianooo.practice'
function loadSettings(): Settings {
  const d: Settings = { mode: 'off', hand: 'R', accompany: true, autoTempo: false }
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (s.mode === 'off' || s.mode === 'wait' || s.mode === 'rhythm') d.mode = s.mode
    if (s.hand === 'L' || s.hand === 'R' || s.hand === 'both') d.hand = s.hand
    if (typeof s.accompany === 'boolean') d.accompany = s.accompany
    if (typeof s.autoTempo === 'boolean') d.autoTempo = s.autoTempo
  } catch {}
  return d
}
function saveSettings() {
  const { mode, hand, accompany, autoTempo } = usePractice.getState()
  try { localStorage.setItem(KEY, JSON.stringify({ mode, hand, accompany, autoTempo })) } catch {}
}

const emptyStats = (): PracticeStats => ({ correct: 0, wrong: 0, missed: 0, perfect: 0, early: 0, late: 0, streak: 0, bestStreak: 0 })

export const usePractice = create<PracticeState>((set) => ({
  ...loadSettings(),
  running: false,
  waiting: false,
  countdown: null,
  stats: emptyStats(),
  summary: null,
  judgement: null,
  setMode: (mode) => { stopPractice(); set({ mode }); saveSettings() },
  setHand: (hand) => { set({ hand }); saveSettings(); onSettingsChanged() },
  setAccompany: (accompany) => { set({ accompany }); saveSettings(); onSettingsChanged() },
  setAutoTempo: (autoTempo) => { set({ autoTempo }); saveSettings() },
  dismissSummary: () => set({ summary: null }),
}))

export const practiceActive = () => usePractice.getState().mode !== 'off'
export const practiceRunning = () => usePractice.getState().running

// ── Tuning ──────────────────────────────────────────────────────────────────
const CHORD_SEC = 0.05        // notes starting this close together form one step (wait)
const HOLD_EPS = 0.002        // hold just before the step so its accompaniment waits too
const WINDOW_SEC = 0.2        // rhythm: a hit within ± this (real seconds) counts
const PERFECT_SEC = 0.08      // rhythm: within ± this is "on time"
const MAX_NOTE_MS = 8000
const PASS_ACCURACY = 0.9
const TEMPO_STEP = 1.05

// ── Song data for one run ───────────────────────────────────────────────────
interface Target { time: number; midi: number; hand: Hand; judged: boolean }
interface Step { time: number; notes: Target[]; hit: Set<Target>; done: boolean }
interface AccNote { time: number; midi: number; velocity: number; duration: number; channel: number; color?: string }

let targets: Target[] = []
let steps: Step[] = []
let acc: AccNote[] = []

function activeMidi(): any {
  return (NES.dirty && NES.editMidi) ? NES.editMidi : useStore.getState().midi
}

export function noteHand(n: { hand?: Hand; midi: number }): Hand {
  return n.hand ?? (n.midi < 60 ? 'L' : 'R')
}

function build() {
  const midi = activeMidi()
  const { tracks } = useStore.getState()
  const { hand, accompany } = usePractice.getState()
  const hasSolo = tracks.some(t => t.solo)
  targets = []; acc = []
  for (const track of midi?.tracks ?? []) {
    const ts = tracks.find(t => t.index === track.index)
    if (!ts) continue
    const audible = !ts.muted && (!hasSolo || ts.solo)
    const mine = !track.isDrum && isShown(ts, hasSolo)
    for (const n of track.notes) {
      const h = noteHand(n)
      if (mine && (hand === 'both' || h === hand)) {
        targets.push({ time: n.time, midi: n.midi, hand: h, judged: false })
      } else if (accompany && audible) {
        acc.push({ time: n.time, midi: n.midi, velocity: n.velocity, duration: n.duration, channel: track.channel, color: ts.color })
      }
    }
  }
  targets.sort((a, b) => a.time - b.time)
  acc.sort((a, b) => a.time - b.time)
  steps = []
  for (const n of targets) {
    const last = steps[steps.length - 1]
    if (last && n.time - last.time <= CHORD_SEC) last.notes.push(n)
    else steps.push({ time: n.time, notes: [n], hit: new Set(), done: false })
  }
}

// First index with time >= t
function lowerBound<T extends { time: number }>(list: T[], t: number): number {
  let lo = 0, hi = list.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].time < t) lo = mid + 1; else hi = mid }
  return lo
}

// ── Run state ───────────────────────────────────────────────────────────────
let raf: number | null = null
let t = 0                 // song seconds
let lastSet = -1          // the playhead value this module last wrote
let lastPerf = 0
let accIdx = 0
let stepIdx = 0
let missIdx = 0
let countdownEnd = 0
let countdownBeat = 0
let lit = new Set<number>()
let passTempoFrom = 100

const ratio = () => { const s = useStore.getState(); return (s.bpm / s.originalBpm) || 1 }
const transpose = () => useStore.getState().detectedKey?.transpose ?? 0
const tempoPct = () => Math.round(ratio() * 100)

function playNote(m: number, vel: number, durMs: number, channel?: number, visual = true, color?: string) {
  const fn = (window as any).__orfeoPlayNote as ((m: number, v: number, d: number, ch?: number, visual?: boolean, color?: string) => void) | undefined
  fn?.(m, vel, durMs, channel, visual, color)
}

// Place the run at song time `to` (start, seek, loop)
function resync(to: number) {
  t = to
  accIdx = lowerBound(acc, to - 1e-4)
  for (const tg of targets) tg.judged = tg.time < to - 1e-4
  missIdx = lowerBound(targets, to - 1e-4)
  for (const s of steps) { s.done = s.time < to - 1e-4; s.hit.clear() }
  stepIdx = lowerBound(steps, to - 1e-4)
  clearLit()
  usePractice.setState({ waiting: false })
}

// ── Expected keys lit on the on-screen keyboard while waiting ───────────────
function showLit(step: Step) {
  const { lh, rh } = handHex()
  const tr = transpose()
  const { activeKeys, activeKeyColors } = useStore.getState()
  const nk = new Set(activeKeys), nc = new Map(activeKeyColors)
  for (const n of step.notes) {
    if (step.hit.has(n)) continue
    const k = n.midi + tr
    nk.add(k); nc.set(k, n.hand === 'L' ? lh : rh); lit.add(k)
  }
  useStore.setState({ activeKeys: nk, activeKeyColors: nc })
}
function clearLit() {
  if (!lit.size) return
  const { activeKeys, activeKeyColors, midiHeldKeys } = useStore.getState()
  const nk = new Set(activeKeys), nc = new Map(activeKeyColors)
  for (const k of lit) if (!midiHeldKeys?.has?.(k)) { nk.delete(k); nc.delete(k) }
  lit = new Set()
  useStore.setState({ activeKeys: nk, activeKeyColors: nc })
}

// ── Scoring ─────────────────────────────────────────────────────────────────
function judge(kind: Judgement) {
  const s = { ...usePractice.getState().stats }
  if (kind === 'wrong') { s.wrong++; s.streak = 0 }
  else if (kind === 'miss') { s.missed++; s.streak = 0 }
  else {
    s.correct++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak)
    if (kind === 'perfect') s.perfect++
    else if (kind === 'early') s.early++
    else if (kind === 'late') s.late++
  }
  usePractice.setState({ stats: s, judgement: { kind, at: performance.now() } })
}

function accuracyOf(mode: 'wait' | 'rhythm', s: PracticeStats): number {
  const total = s.correct + s.wrong + (mode === 'rhythm' ? s.missed : 0)
  return total ? s.correct / total : 0
}

// End of one pass through the song or the loop
function endPass(finished: boolean) {
  const st = usePractice.getState()
  if (st.mode === 'off') return
  const stats = st.stats
  if (stats.correct + stats.wrong + stats.missed === 0) return
  const accuracy = accuracyOf(st.mode, stats)
  const from = passTempoFrom
  if (st.autoTempo && accuracy >= PASS_ACCURACY) {
    const s = useStore.getState()
    if (s.bpm < s.originalBpm) s.setBpm(Math.min(s.originalBpm, Math.round(s.bpm * TEMPO_STEP)))
  }
  const to = tempoPct()
  usePractice.setState({ summary: { mode: st.mode, accuracy, stats, tempoFrom: from, tempoTo: to, finished }, stats: emptyStats() })
  passTempoFrom = to
}

// ── The clock ───────────────────────────────────────────────────────────────
function tick(now: number) {
  raf = null
  const st = usePractice.getState()
  if (!st.running) return
  const s = useStore.getState()
  if (!s.midi) { pausePractice(); return }

  // Someone moved the playhead (scrub, skip, step): continue from there
  if (Math.abs(s.currentTime - lastSet) > 1e-3) resync(s.currentTime)

  const r = ratio()
  if (st.countdown !== null) {
    if (now >= countdownEnd) usePractice.setState({ countdown: null })
    else {
      const left = Math.ceil((countdownEnd - now) / countdownBeat)
      if (left !== st.countdown) { usePractice.setState({ countdown: left }); click(false) }
    }
    lastPerf = now
    raf = requestAnimationFrame(tick)
    return
  }

  const dt = Math.min(0.1, Math.max(0, (now - lastPerf) / 1000)) * r
  lastPerf = now
  let next = t + dt

  // Wait mode: hold at the next step until it is played
  if (st.mode === 'wait') {
    const step = steps[stepIdx]
    if (step && next >= step.time - HOLD_EPS) {
      next = Math.max(t, step.time - HOLD_EPS)
      if (!st.waiting) { usePractice.setState({ waiting: true }); showLit(step) }
    }
  }

  // End of the loop or the song
  const dur = s.midi.duration ?? 0
  const loopOn = s.loopRegionActive
  const end = loopOn && s.loopEnd !== null ? s.loopEnd : dur
  if (end > 0 && next >= end) {
    playAccUntil(end)
    if (loopOn) {
      endPass(false)
      const start = s.loopStart ?? 0
      resync(start); setTime(start)
      raf = requestAnimationFrame(tick)
      return
    }
    setTime(end)
    endPass(true)
    stopRun()
    return
  }

  playAccUntil(next)

  // Rhythm mode: notes that went past unplayed
  if (st.mode === 'rhythm') {
    const limit = next - WINDOW_SEC * r
    while (missIdx < targets.length && targets[missIdx].time < limit) {
      const tg = targets[missIdx++]
      if (!tg.judged) { tg.judged = true; judge('miss') }
    }
  }

  setTime(next)
  raf = requestAnimationFrame(tick)
}

function setTime(v: number) {
  t = v; lastSet = v
  useStore.setState({ currentTime: v })
}

function playAccUntil(until: number) {
  const r = ratio(), tr = transpose()
  while (accIdx < acc.length && acc[accIdx].time <= until) {
    const n = acc[accIdx++]
    if (n.time < t - 0.25) continue          // skipped over (seek): don't fire a burst
    playNote(n.midi + tr, n.velocity, Math.min(MAX_NOTE_MS, Math.max(80, (n.duration / r) * 1000)), n.channel, true, n.color)
  }
}

function click(accent: boolean) {
  playNote(accent ? 76 : 77, accent ? 0.9 : 0.7, 80, 9, false)
}

// ── Keys from your keyboard (MIDI or on-screen) ─────────────────────────────
export function practiceNoteInput(note: number) {
  const st = usePractice.getState()
  if (!st.running || st.countdown !== null) return
  const tr = transpose(), r = ratio()

  if (st.mode === 'wait') {
    const step = steps[stepIdx]
    // Any key of the next step counts, however early: in this mode only
    // the right notes matter, not the timing
    if (step) {
      const n = step.notes.find(x => !step.hit.has(x) && x.midi + tr === note)
      if (n) {
        step.hit.add(n)
        judge('hit')
        pushHitEffect(note, n.hand === 'L' ? handHex().lh : handHex().rh)
        // The hint light goes out; a key you hold keeps its own light
        if (lit.has(note)) {
          lit.delete(note)
          const { activeKeys, activeKeyColors, midiHeldKeys } = useStore.getState()
          if (!midiHeldKeys?.has?.(note)) {
            const nk = new Set(activeKeys), nc = new Map(activeKeyColors)
            nk.delete(note); nc.delete(note)
            useStore.setState({ activeKeys: nk, activeKeyColors: nc })
          }
        }
        if (step.hit.size === step.notes.length) {
          step.done = true
          stepIdx++
          clearLit()
          usePractice.setState({ waiting: false })
        }
        return
      }
    }
    judge('wrong')
    return
  }

  // Rhythm: the closest unplayed note of this pitch within the window
  const win = WINDOW_SEC * r
  let best: Target | null = null
  for (let i = lowerBound(targets, t - win); i < targets.length && targets[i].time <= t + win; i++) {
    const tg = targets[i]
    if (tg.judged || tg.midi + tr !== note) continue
    if (!best || Math.abs(tg.time - t) < Math.abs(best.time - t)) best = tg
  }
  if (!best) { judge('wrong'); return }
  best.judged = true
  const dReal = (t - best.time) / r
  judge(Math.abs(dReal) <= PERFECT_SEC ? 'perfect' : dReal < 0 ? 'early' : 'late')
  pushHitEffect(note, best.hand === 'L' ? handHex().lh : handHex().rh)
}

// ── Start / pause / stop ────────────────────────────────────────────────────
export function startPractice() {
  const st = usePractice.getState()
  const s = useStore.getState()
  if (st.mode === 'off' || !s.midi || st.running) return
  if (s.playbackState === 'playing') useStore.setState({ playbackState: 'paused' })
  if (s.audioEngine === 'gm') (window as any).__orfeoWarmupEditChannels?.()
  build()
  let from = s.currentTime
  const dur = s.midi.duration ?? 0
  if (s.loopRegionActive && s.loopStart !== null && s.loopEnd !== null && (from < s.loopStart || from >= s.loopEnd)) from = s.loopStart
  if (dur > 0 && from >= dur - 0.05) from = 0
  resync(from); setTime(from)
  passTempoFrom = tempoPct()
  const fresh = st.summary !== null || (st.stats.correct + st.stats.wrong + st.stats.missed === 0)
  lastPerf = performance.now()
  // Rhythm: one bar of count-in clicks so the first note isn't a surprise
  let countdown: number | null = null
  if (st.mode === 'rhythm') {
    const beats = Math.max(2, Math.min(6, s.midi.timeSignatureNumerator || 4))
    countdownBeat = 60000 / (s.bpm || 120)
    countdownEnd = lastPerf + beats * countdownBeat
    countdown = beats
    click(true)
  }
  usePractice.setState({ running: true, waiting: false, countdown, summary: null, ...(fresh ? { stats: emptyStats() } : {}) })
  raf = requestAnimationFrame(tick)
}

function stopRun() {
  if (raf !== null) cancelAnimationFrame(raf)
  raf = null
  clearLit()
  usePractice.setState({ running: false, waiting: false, countdown: null })
}

export function pausePractice() { stopRun() }

export function stopPractice() {
  stopRun()
  usePractice.setState({ stats: emptyStats(), summary: null, judgement: null })
}

// Settings changed mid-run: rebuild the song data at the current position
function onSettingsChanged() {
  const st = usePractice.getState()
  if (st.mode === 'off') { if (st.running) stopPractice(); return }
  if (st.running) { build(); resync(t) }
}

// A new song or a closed one ends the run
let _midiSeen: unknown = null
let _tracksSeen: unknown = null
useStore.subscribe((s) => {
  if (s.tracks !== _tracksSeen) {
    _tracksSeen = s.tracks
    if (s.midi === _midiSeen && usePractice.getState().running) { build(); resync(t) }
  }
  if (s.midi === _midiSeen) return
  _midiSeen = s.midi
  if (usePractice.getState().running) stopPractice()
  else usePractice.setState({ stats: emptyStats(), summary: null })
})

// ── The keys the current step still needs (wait mode) — what the microphone
// listens for (micInput.ts) ─────────────────────────────────────────────────
export function expectedNotes(): number[] {
  const st = usePractice.getState()
  if (!st.running || st.mode !== 'wait' || st.countdown !== null) return []
  const s = steps[stepIdx]; const tr = transpose()
  return s ? s.notes.filter(n => !s.hit.has(n)).map(n => n.midi + tr) : []
}

// ── Test hook ───────────────────────────────────────────────────────────────
;(window as any).__pianoooPractice = {
  input: practiceNoteInput,
  expected: () => { const s = steps[stepIdx]; const tr = transpose(); return s ? s.notes.filter(n => !s.hit.has(n)).map(n => n.midi + tr) : [] },
  steps: () => { const tr = transpose(); return steps.map(s => s.notes.map(n => n.midi + tr)) },
  time: () => t,
  due: () => { const tr = transpose(); return targets.filter(x => !x.judged && x.time - t < 0.11 && x.time - t > -0.02).map(x => x.midi + tr) },
}
