// iPad entry point: installs the iPad bridge (window.electronAPI) and touch
// support, then starts the same App the desktop runs.
import { installIpadBridge } from './platform/ipad/bridge'
import { installTouchShim } from './platform/ipad/touchShim'
import { installWebMidi } from './platform/ipad/webMidi'
import './platform/ipad/ipad.css'

async function start() {
  installTouchShim()
  installWebMidi()
  try {
    await installIpadBridge()
  } catch (e) {
    console.error('[Orfeo iPad] startup failed:', e)
  }
  // Imported only now: some modules read window.electronAPI when they load
  await import('./main')
}

void start()
