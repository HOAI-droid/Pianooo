import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.hoaidroid.pianooo',
  appName: 'Pianooo',
  webDir: 'dist-ipad',
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    backgroundColor: '#111216',
  },
}

export default config
