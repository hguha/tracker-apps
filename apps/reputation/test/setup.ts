// Gives Dexie a working IndexedDB under Node so repository logic is testable
// without spinning up a browser.
import 'fake-indexeddb/auto'

/**
 * A minimal `localStorage`, for the auth provider's session persistence.
 *
 * Hand-rolled rather than switching the whole suite to jsdom: the repository and
 * metrics tests are pure logic and run an order of magnitude faster in `node`,
 * and this is the only browser API they need.
 */
function hasWorkingLocalStorage(): boolean {
  try {
    // Node 26 *declares* localStorage but throws on use unless started with
    // --localstorage-file, so presence alone isn't enough to go on.
    globalThis.localStorage.setItem('__probe__', '1')
    globalThis.localStorage.removeItem('__probe__')
    return true
  } catch {
    return false
  }
}

if (!hasWorkingLocalStorage()) {
  const store = new Map<string, string>()
  const shim: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: shim, writable: true })
}
