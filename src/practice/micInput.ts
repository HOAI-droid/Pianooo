// ── Practise with an acoustic piano: the microphone as input ─────────────────
// For pianos without MIDI. In "Wait for me" the app knows which keys come
// next, so the microphone doesn't have to transcribe what you play — it only
// checks whether the EXPECTED notes have just been struck:
//
//   1. Spectrum of the microphone signal (Web Audio AnalyserNode).
//   2. For every key: how strongly its fundamental and overtones sound
//      ("salience"), tuned to your piano (calibration with an A).
//   3. An expected key counts when it is clearly above the room noise, has
//      just risen (a new strike, not a note still ringing), is stronger than
//      its neighbours, and isn't only the overtone of a lower note you played
//      (an octave or a twelfth below).
//
// Accepted keys go to practiceNoteInput() exactly like keys from a MIDI
// keyboard. Nothing is recorded or stored; the analysis runs on the device.

import { create } from 'zustand'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { usePractice, practiceNoteInput, expectedNotes } from './practice'

export type InputSource = 'midi' | 'mic'
export type Sensitivity = 'low' | 'medium' | 'high'
export type MicStatus = 'off' | 'starting' | 'on' | 'denied' | 'unsupported' | 'error'

interface MicState {
  input: InputSource
  sensitivity: Sensitivity
  tuningCents: number
  status: MicStatus
  level: number                 // 0..1, for the level meter
  calibrating: boolean
  calibResult: number | 'fail' | null
  preview: boolean              // panel open: keep the microphone on for the meter
  heard: { midi: number; at: number } | null
  setInput: (v: InputSource) => void
  setSensitivity: (v: Sensitivity) => void
  setPreview: (v: boolean) => void
  calibrate: () => void
}

const KEY = 'pianooo.mic'
function load() {
  const d = { input: 'midi' as InputSource, sensitivity: 'medium' as Sensitivity, tuningCents: 0 }
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (s.input === 'midi' || s.input === 'mic') d.input = s.input
    if (s.sensitivity === 'low' || s.sensitivity === 'medium' || s.sensitivity === 'high') d.sensitivity = s.sensitivity
    if (typeof s.tuningCents === 'number' && Math.abs(s.tuningCents) <= 100) d.tuningCents = s.tuningCents
  } catch {}
  return d
}
function save() {
  const { input, sensitivity, tuningCents } = useMic.getState()
  try { localStorage.setItem(KEY, JSON.stringify({ input, sensitivity, tuningCents })) } catch {}
}

export const useMic = create<MicState>((set) => ({
  ...load(),
  status: 'off',
  level: 0,
  calibrating: false,
  calibResult: null,
  preview: false,
  heard: null,
  setInput: (input) => {
    set({ input }); save()
    // The app's own playback would reach the microphone too
    if (input === 'mic' && usePractice.getState().accompany) usePractice.getState().setAccompany(false)
    sync()
  },
  setSensitivity: (sensitivity) => { set({ sensitivity }); save() },
  setPreview: (preview) => { set({ preview }); sync() },
  calibrate: () => { set({ calibrating: true, calibResult: null }); calib = []; calibUntil = performance.now() + 5000; sync() },
}))

// ── Tuning ──────────────────────────────────────────────────────────────────
const LO = 21, HI = 108              // A0 … C8
const HIST = 10                      // frames kept per key (≈ 250 ms)
const FRAME_MS = 25
const REFIRE_MS = 250
const THRESH: Record<Sensitivity, { k: number; rise: number }> = {
  low: { k: 10, rise: 1.8 },
  medium: { k: 6, rise: 1.5 },
  high: { k: 3.5, rise: 1.3 },
}

// ── Audio state ─────────────────────────────────────────────────────────────
let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let analyser: AnalyserNode | null = null
let timer: ReturnType<typeof setInterval> | null = null
let db = new Float32Array(0)
let mag = new Float32Array(0)
let td = new Float32Array(0)
let binHz = 1
let nyquist = 1
const sal = new Float32Array(128)
const hist: Float32Array[] = Array.from({ length: 128 }, () => new Float32Array(HIST))
let histPos = 0
let histFill = 0
const lastEmit = new Map<number, number>()
let calib: number[] = []
let calibUntil = 0
let starting = false
let nativeOn = false
let nativeListener: PluginListenerHandle | null = null

// iPad and Mac app: the microphone is read natively (ios/App/App/PianoooMidiPlugin.swift)
// — the web view's own microphone access isn't available everywhere
interface NativeMic {
  startMic(): Promise<{ sampleRate: number; fftSize: number }>
  stopMic(): Promise<void>
  addListener(event: 'micFrame', fn: (e: { db: string; rms: number; sr: number; n: number }) => void): Promise<PluginListenerHandle>
}
const NativeMicPlugin = registerPlugin<NativeMic>('PianoooMidi')
// Android's web view gives the page the microphone itself (with the system's
// permission prompt), so only iPad and Mac use the native path
const useNative = () => Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('PianoooMidi')

function wanted(): boolean {
  const m = useMic.getState(), p = usePractice.getState()
  if (m.input !== 'mic') return false
  return m.preview || m.calibrating || (p.running && p.mode === 'wait')
}

function sync() {
  const on = !!ctx || nativeOn
  if (wanted()) { if (!on && !starting) void (useNative() ? startNative() : start()) }
  else if (on) { if (nativeOn) stopNative(); else stop() }
}

function resetAnalysis() { histFill = 0; lastEmit.clear() }

async function startNative() {
  starting = true
  useMic.setState({ status: 'starting' })
  try {
    if (!nativeListener) nativeListener = await NativeMicPlugin.addListener('micFrame', nativeFrame)
    await NativeMicPlugin.startMic()
    nativeOn = true
    resetAnalysis()
    useMic.setState({ status: 'on' })
    if (!wanted()) stopNative()
  } catch (e: any) {
    const denied = e && (e.code === 'denied' || /denied/i.test(String(e.message ?? '')))
    useMic.setState({ status: denied ? 'denied' : 'error' })
  } finally {
    starting = false
  }
}

function stopNative() {
  nativeOn = false
  void NativeMicPlugin.stopMic().catch(() => {})
  useMic.setState({ status: 'off', level: 0 })
}

// One spectrum from the native side: magnitudes up to 5 kHz in 0.5 dB steps
function nativeFrame(e: { db: string; rms: number; sr: number; n: number }) {
  if (!nativeOn) return
  const bin = atob(e.db)
  if (db.length !== bin.length) { db = new Float32Array(bin.length); mag = new Float32Array(bin.length) }
  for (let i = 0; i < bin.length; i++) {
    const d = bin.charCodeAt(i) / 2 - 130
    db[i] = d
    mag[i] = i === 0 ? 0 : Math.pow(10, d / 20)
  }
  binHz = e.sr / e.n
  // Partials above the last bin sent count as absent (peak() checks nyquist·0.95)
  nyquist = (bin.length - 1) * binHz / 0.95
  analyse(e.rms)
}

async function start() {
  const md = (navigator as any).mediaDevices
  if (!md?.getUserMedia) { useMic.setState({ status: 'unsupported' }); return }
  starting = true
  useMic.setState({ status: 'starting' })
  // Create the context inside the tap that started this (iOS needs a gesture)
  let c: AudioContext
  try { c = new (window.AudioContext || (window as any).webkitAudioContext)() } catch { starting = false; useMic.setState({ status: 'error' }); return }
  try {
    const s: MediaStream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    if (!wanted()) { s.getTracks().forEach(t => t.stop()); void c.close(); starting = false; useMic.setState({ status: 'off' }); return }
    if (c.state === 'suspended') { try { await c.resume() } catch {} }
    const src = c.createMediaStreamSource(s)
    const an = c.createAnalyser()
    an.fftSize = 8192
    an.smoothingTimeConstant = 0
    an.minDecibels = -130
    an.maxDecibels = 0
    src.connect(an)
    ctx = c; stream = s; analyser = an
    db = new Float32Array(an.frequencyBinCount)
    mag = new Float32Array(an.frequencyBinCount)
    td = new Float32Array(an.fftSize)
    binHz = c.sampleRate / an.fftSize
    nyquist = c.sampleRate / 2
    resetAnalysis()
    timer = setInterval(frame, FRAME_MS)
    useMic.setState({ status: 'on' })
  } catch (e: any) {
    void c.close()
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    useMic.setState({ status: denied ? 'denied' : 'error' })
  } finally {
    starting = false
  }
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  try { void ctx?.close() } catch {}
  ctx = null; analyser = null
  useMic.setState({ status: 'off', level: 0 })
}

// ── Spectrum helpers ────────────────────────────────────────────────────────
const SPAN = Math.pow(2, 30 / 1200) - 1       // ± 30 cents around a partial

function peak(f: number): number {
  if (f <= 20 || f >= nyquist * 0.95) return 0
  const c = f / binHz
  const w = Math.max(1, c * SPAN)
  const lo = Math.max(1, Math.floor(c - w)), hi = Math.min(mag.length - 1, Math.ceil(c + w))
  let m = 0
  for (let i = lo; i <= hi; i++) if (mag[i] > m) m = mag[i]
  return m
}

function freqOf(midi: number, tuning: number) { return 440 * Math.pow(2, (midi - 69) / 12) * tuning }

function salience(midi: number, tuning: number): number {
  const f0 = freqOf(midi, tuning)
  const H = Math.max(1, Math.min(8, Math.floor(4500 / f0)))
  let s = 0
  for (let h = 1; h <= H; h++) s += peak(f0 * h)
  return s / H
}

// Room noise: median magnitude between 60 Hz and 4 kHz
function noiseFloor(): number {
  const lo = Math.ceil(60 / binHz), hi = Math.min(mag.length - 1, Math.floor(4000 / binHz))
  const vals: number[] = []
  for (let i = lo; i <= hi; i += 3) vals.push(mag[i])
  vals.sort((a, b) => a - b)
  return vals[vals.length >> 1] || 1e-7
}

function accept(m: number, expected: Set<number>, floor: number, tuning: number, prevMin: number): boolean {
  const { k, rise } = THRESH[useMic.getState().sensitivity]
  const s = sal[m]
  if (s < floor * k) return false
  // A new strike, not a note that is still ringing
  if (histFill >= 4 && s < prevMin * rise) return false
  // The neighbouring key isn't the one actually sounding
  for (const n of [m - 1, m + 1]) if (!expected.has(n) && sal[n] > s * 0.9) return false
  const f0 = freqOf(m, tuning)
  const own = peak(f0)
  // Only the overtone of a lower note (an octave or a twelfth below)?
  for (const [kk, low] of [[2, m - 12], [3, m - 19]] as const) {
    if (expected.has(low)) continue
    let ev = 0, cnt = 0
    for (let n = 1; n <= 2 * kk; n++) if (n % kk) { ev += peak(f0 * n / kk); cnt++ }
    ev /= cnt
    if (ev > floor * k && ev > own * 0.6) return false
  }
  // The octave above played instead: our odd partials would be missing
  if (!expected.has(m + 12) && f0 * 4 < nyquist * 0.95) {
    const odd = own + peak(f0 * 3), even = peak(f0 * 2) + peak(f0 * 4)
    if (odd < even * 0.25) return false
  }
  return true
}

// One spectrum from the web view's microphone (desktop and test browsers)
function frame() {
  if (!analyser || !ctx) return
  analyser.getFloatFrequencyData(db)
  for (let i = 0; i < db.length; i++) mag[i] = Math.pow(10, db[i] / 20)
  analyser.getFloatTimeDomainData(td)
  let rms = 0
  for (let i = 0; i < td.length; i++) rms += td[i] * td[i]
  rms = Math.sqrt(rms / td.length)
  analyse(rms)
}

function analyse(rms: number) {
  const level = Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 60) / 50))

  const mic = useMic.getState()
  const tuning = Math.pow(2, mic.tuningCents / 1200)
  const floor = noiseFloor()
  for (let m = LO; m <= HI; m++) sal[m] = salience(m, tuning)

  // Calibration: the strongest A (A3, A4 or A5) in the signal
  if (mic.calibrating) {
    calibFrame(floor)
    // Done after enough clear frames (≈ 0.4 s of a ringing A), at the latest after 5 s
    if (calib.length >= 16 || performance.now() >= calibUntil) finishCalibration()
  }

  const now = performance.now()
  const exp = expectedNotes()
  if (exp.length) {
    const set = new Set(exp)
    for (const m of exp) {
      if (m < LO || m > HI) continue
      if (now - (lastEmit.get(m) ?? -1e9) < REFIRE_MS) continue
      let prevMin = Infinity
      const h = hist[m]
      for (let i = 0; i < Math.min(histFill, HIST); i++) if (h[i] < prevMin) prevMin = h[i]
      if (accept(m, set, floor, tuning, prevMin)) {
        lastEmit.set(m, now)
        useMic.setState({ heard: { midi: m, at: now } })
        practiceNoteInput(m)
      }
    }
  }

  // History after the checks, so "has it just risen" compares with the past
  for (let m = LO; m <= HI; m++) hist[m][histPos] = sal[m]
  histPos = (histPos + 1) % HIST
  histFill++

  if (Math.abs(level - mic.level) > 0.02) useMic.setState({ level })
}

function calibFrame(floor: number) {
  let best = 0, bestI = -1, bestBase = 440
  for (const base of [220, 440, 880]) {
    const lo = Math.max(1, Math.floor(base * Math.pow(2, -80 / 1200) / binHz))
    const hi = Math.min(mag.length - 2, Math.ceil(base * Math.pow(2, 80 / 1200) / binHz))
    for (let i = lo; i <= hi; i++) if (mag[i] > best) { best = mag[i]; bestI = i; bestBase = base }
  }
  if (bestI < 1 || best < floor * 8) return
  const a = db[bestI - 1], b = db[bestI], c = db[bestI + 1]
  const d = a - 2 * b + c
  const p = d !== 0 ? 0.5 * (a - c) / d : 0
  const f = (bestI + Math.max(-0.5, Math.min(0.5, p))) * binHz
  calib.push(1200 * Math.log2(f / bestBase))
}

function finishCalibration() {
  const vals = calib.slice().sort((x, y) => x - y)
  if (vals.length >= 8) {
    const cents = Math.max(-100, Math.min(100, Math.round(vals[vals.length >> 1])))
    useMic.setState({ calibrating: false, calibResult: cents, tuningCents: cents })
    save()
  } else {
    useMic.setState({ calibrating: false, calibResult: 'fail' })
  }
  sync()
}

// Follow the practice run: listen while "Wait for me" is running
usePractice.subscribe(() => sync())

// ── Test hook: feed spectra as the native side sends them ───────────────────
;(window as any).__pianoooMic = {
  feedNative: (e: { db: string; rms: number; sr: number; n: number }) => { nativeOn = true; nativeFrame(e) },
}
