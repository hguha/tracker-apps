import { Window } from 'happy-dom'

const page = new Window()
for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, { value: page[name], configurable: true })
}
