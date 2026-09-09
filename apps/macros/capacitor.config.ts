import type { CapacitorConfig } from '@capacitor/cli'

// The native shell loads the web build from `dist/`. MACROcosm's web deploy already builds at the
// root, so `npm run build:native` differs from `npm run build` only in being explicit about it.
const config: CapacitorConfig = {
  appId: 'com.hirshguha.macrocosm',
  appName: 'MACROcosm',
  webDir: 'dist',
  backgroundColor: '#f9f9f7',
  ios: {
    // Match the light-mode page surface so there's no white flash before first paint.
    backgroundColor: '#f9f9f7',
    // The web app draws edge-to-edge (viewport-fit=cover) and handles safe areas itself via
    // env(safe-area-inset-*). 'never' lets the WebView fill the screen; 'always' would inset the
    // content as well and leave a gap at the bottom — the failure REPutation spent eight attempts on.
    contentInset: 'never',
  },
  android: {
    backgroundColor: '#f9f9f7',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#f9f9f7',
      showSpinner: false,
    },
  },
}

export default config
