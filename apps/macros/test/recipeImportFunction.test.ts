import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type Handler = (request: Request) => Promise<Response>

let handler: Handler

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    serve: (fn: Handler) => {
      handler = fn
    },
  })
  const path = new URL('../supabase/functions/recipe-import/index.ts', import.meta.url).href
  await import(/* @vite-ignore */ path)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const jwt = (claims: Record<string, unknown>) =>
  ['e30', btoa(JSON.stringify(claims)).replace(/=+$/, ''), 'sig'].join('.')

const SIGNED_IN = jwt({ sub: 'user-1', role: 'authenticated' })
const ANON_KEY = jwt({ iss: 'supabase', role: 'anon' })

const RECIPE_PAGE = `<html><script type="application/ld+json">${JSON.stringify({
  '@type': 'Recipe',
  name: 'Soup',
  recipeIngredient: ['1 onion'],
})}</script></html>`

function fakeWeb(pages: Record<string, () => Response> = {}): string[] {
  const requested: string[] = []
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    requested.push(url)
    const response = pages[url]?.() ?? new Response(RECIPE_PAGE, { status: 200 })
    const location = response.headers.get('Location')
    if (location && (init?.redirect ?? 'follow') === 'follow') {
      return fetchMock(new URL(location, url).href, init)
    }
    return response
  }
  vi.stubGlobal('fetch', fetchMock)
  return requested
}

const redirectTo = (location: string) => () =>
  new Response(null, { status: 302, headers: { Location: location } })

function call(url: string, token = SIGNED_IN) {
  return handler(
    new Request('https://fn.test/recipe-import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  ).then((response) => response.json() as Promise<{ error?: string; ingredients?: string[] }>)
}

describe('recipe-import', () => {
  it('reads a public page for a signed-in user', async () => {
    fakeWeb()
    const body = await call('https://recipes.example.com/soup')
    expect(body.ingredients).toEqual(['1 onion'])
  })

  it('refuses the anon key, which the gateway accepts as a valid JWT', async () => {
    const requested = fakeWeb()
    const body = await call('https://recipes.example.com/soup', ANON_KEY)
    expect(body.error).toBeTruthy()
    expect(requested).toEqual([])
  })

  it('refuses a loopback host written with a trailing dot', async () => {
    const requested = fakeWeb()
    const body = await call('http://localhost./admin')
    expect(body.error).toBeTruthy()
    expect(requested).toEqual([])
  })

  it('does not follow a redirect to a private address', async () => {
    const requested = fakeWeb({
      'https://recipes.example.com/soup': redirectTo('http://169.254.169.254/latest/meta-data/'),
    })
    const body = await call('https://recipes.example.com/soup')
    expect(body.error).toBeTruthy()
    expect(requested).toEqual(['https://recipes.example.com/soup'])
  })

  it('follows a redirect to another public page', async () => {
    const requested = fakeWeb({ 'https://recipes.example.com/soup': redirectTo('/soup-v2') })
    const body = await call('https://recipes.example.com/soup')
    expect(body.ingredients).toEqual(['1 onion'])
    expect(requested).toEqual([
      'https://recipes.example.com/soup',
      'https://recipes.example.com/soup-v2',
    ])
  })
})
