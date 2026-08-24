import type { CapacitorConfig } from '@capacitor/cli'

// The native shell loads the web build from `dist/`. Build it with BASE_PATH=/
// (npm run build:native) so asset URLs resolve from the bundle root, not the
// /workout-tracker/ subpath the web deploy uses.
const config: CapacitorConfig = {
  appId: 'com.hirshguha.fitnote',
  appName: 'REPutation',
  webDir: 'dist',
  backgroundColor: '#fcfcfb',
  ios: {
    // Match the light-mode surface so there's no white flash before first paint.
    backgroundColor: '#fcfcfb',
    // The web app draws edge-to-edge (viewport-fit=cover) and handles safe areas
    // itself via env(safe-area-inset-*). 'never' lets the WebView fill the screen;
    // 'always' would inset the content too and leave a white gap at the bottom.
    contentInset: 'never',
  },
  android: {
    backgroundColor: '#fcfcfb',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#fcfcfb',
      showSpinner: false,
    },
  },
}

export default config
