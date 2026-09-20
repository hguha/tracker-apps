import type { CapacitorConfig } from '@capacitor/cli'

// The native shell loads the web build from `dist/`. `npm run build:native` sets `BASE_PATH=/`
// because the web deploy builds for `macrocosm.fitness/app` — inside the bundle the app is at the
// root, and an /app/ prefix would make every asset URL miss.
const config: CapacitorConfig = {
  appId: 'com.hirshguha.macrocosm',
  appName: 'MACROcosm',
  webDir: 'dist',
  backgroundColor: '#fbecdf',
  ios: {
    // Match the light-mode page surface so there's no white flash before first paint.
    backgroundColor: '#fbecdf',
    // The web app draws edge-to-edge (viewport-fit=cover) and handles safe areas itself via
    // env(safe-area-inset-*). 'never' lets the WebView fill the screen; 'always' would inset the
    // content as well and leave a gap at the bottom — the failure REPutation spent eight attempts on.
    contentInset: 'never',
  },
  android: {
    backgroundColor: '#fbecdf',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#fbecdf',
      showSpinner: false,
    },
  },
}

export default config
