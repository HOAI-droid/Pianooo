// Stand-in for Electron's `app` object in code ported from electron/main.ts.
import { DATA, DOCUMENTS } from './vfs'

export const app = {
  getPath(name: string): string {
    // 'music' is where desktop exports go when no library is set
    if (name === 'music') return DOCUMENTS
    return DATA
  },
}
