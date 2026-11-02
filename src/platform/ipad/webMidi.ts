// ── Web MIDI on iPad ─────────────────────────────────────────────────────────
// iPadOS web views have no Web MIDI (navigator.requestMIDIAccess). The app's
// native OrfeoMidi plugin (ios/App/App/OrfeoMidiPlugin.swift) talks to CoreMIDI
// — USB keyboards and Bluetooth LE MIDI keyboards such as the Kawai ES120 —
// and this file presents it as the standard Web MIDI API, so Orfeo's own MIDI
// keyboard code (hooks/useMidiInput.ts) and the General MIDI output (JZZ)
// work unchanged.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

interface NativeEndpoint { id: string; name: string; manufacturer: string }
interface OrfeoMidiPlugin {
  listDevices(): Promise<{ inputs: NativeEndpoint[]; outputs: NativeEndpoint[] }>
  send(opts: { id: string; data: number[] }): Promise<void>
  showBluetoothPairing(): Promise<void>
  addListener(event: 'midiMessage', fn: (e: { id: string; data: number[] }) => void): Promise<PluginListenerHandle>
  addListener(event: 'devicesChanged', fn: () => void): Promise<PluginListenerHandle>
}

export const OrfeoMidi = registerPlugin<OrfeoMidiPlugin>('OrfeoMidi')

type PortState = 'connected' | 'disconnected'

class Port extends EventTarget {
  state: PortState = 'connected'
  connection: 'open' | 'closed' | 'pending' = 'closed'
  onmidimessage: ((e: Event) => void) | null = null
  onstatechange: ((e: Event) => void) | null = null
  version = '1.0'
  constructor(public id: string, public name: string, public manufacturer: string, public type: 'input' | 'output') { super() }
  open() { this.connection = 'open'; return Promise.resolve(this) }
  close() { this.connection = 'closed'; return Promise.resolve(this) }
  send(data: number[] | Uint8Array) {
    if (this.type !== 'output' || this.state !== 'connected') return
    // Drop SysEx: nothing in Orfeo needs it and BLE links choke on large ones
    const bytes = Array.from(data)
    if (!bytes.length || bytes[0] === 0xF0) return
    void OrfeoMidi.send({ id: this.id, data: bytes }).catch(() => {})
  }
  clear() {}
  deliver(bytes: number[]) {
    // WebKit has no MIDIMessageEvent constructor — a plain Event carrying
    // `data` is all Orfeo's handler reads
    const e = new Event('midimessage') as Event & { data: Uint8Array }
    Object.defineProperty(e, 'data', { value: new Uint8Array(bytes) })
    this.dispatchEvent(e)
    this.onmidimessage?.(e)
  }
}

const inputs = new Map<string, Port>()
const outputs = new Map<string, Port>()
const accesses = new Set<Access>()

class Access extends EventTarget {
  onstatechange: ((e: Event) => void) | null = null
  sysexEnabled = false
  get inputs() { return new Map(inputs) }
  get outputs() { return new Map(outputs) }
  fire(port: Port) {
    const e = new Event('statechange') as Event & { port: Port }
    Object.defineProperty(e, 'port', { value: port })
    this.dispatchEvent(e)
    this.onstatechange?.(e)
  }
}

function sync(map: Map<string, Port>, list: NativeEndpoint[], type: 'input' | 'output'): Port[] {
  const changed: Port[] = []
  const present = new Set(list.map(d => d.id))
  for (const d of list) {
    const known = map.get(d.id)
    if (!known) { const p = new Port(d.id, d.name, d.manufacturer, type); map.set(d.id, p); changed.push(p) }
    else if (known.state !== 'connected') { known.state = 'connected'; changed.push(known) }
  }
  // Like Chromium, an unplugged port stays listed as disconnected
  for (const p of map.values()) if (!present.has(p.id) && p.state === 'connected') { p.state = 'disconnected'; changed.push(p) }
  return changed
}

async function refreshDevices() {
  const { inputs: ins, outputs: outs } = await OrfeoMidi.listDevices()
  const changed = [...sync(inputs, ins, 'input'), ...sync(outputs, outs, 'output')]
  for (const p of changed) {
    const e = new Event('statechange')
    p.dispatchEvent(e); p.onstatechange?.(e)
    for (const a of accesses) a.fire(p)
  }
}

let ready: Promise<void> | null = null
function start(): Promise<void> {
  ready ??= (async () => {
    await OrfeoMidi.addListener('midiMessage', ({ id, data }) => inputs.get(id)?.deliver(data))
    await OrfeoMidi.addListener('devicesChanged', () => { void refreshDevices() })
    await refreshDevices()
  })()
  return ready
}

/** Installs navigator.requestMIDIAccess backed by CoreMIDI (iPad app only). */
export function installWebMidi() {
  if (!Capacitor.isPluginAvailable('OrfeoMidi')) return
  const requestMIDIAccess = async () => {
    await start()
    const a = new Access()
    accesses.add(a)
    return a as unknown as MIDIAccess
  }
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: requestMIDIAccess, configurable: true, writable: true })
  // Shown in Settings → MIDI Keyboard
  ;(window as any).orfeoIpad = {
    showBluetoothMidi: () => OrfeoMidi.showBluetoothPairing(),
  }
}
