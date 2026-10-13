import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@macrocosm.fitness'
const PORT = 5642
const ONBOARDING_VERSION = 3

const required = (name) => {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
  return value
}

const url = required('SUPABASE_URL').replace(/\/$/, '')
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
const anonKey = required('SUPABASE_ANON_KEY')
const password = required('DEMO_PASSWORD')

const admin = async (path, init = {}) => {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
}

async function demoUserId() {
  const created = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true }),
  })
  if (created.ok) return created.body.id
  for (let page = 1; page < 50; page += 1) {
    const listed = await admin(`/auth/v1/admin/users?page=${page}&per_page=200`)
    if (!listed.ok) throw new Error(`Listing users failed: ${JSON.stringify(listed.body)}`)
    const user = listed.body.users.find((candidate) => candidate.email === EMAIL)
    if (user) {
      const updated = await admin(`/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password, email_confirm: true }),
      })
      if (!updated.ok) throw new Error(`Updating the demo user failed: ${JSON.stringify(updated.body)}`)
      return user.id
    }
    if (listed.body.users.length < 200) break
  }
  throw new Error(`Could not create or find ${EMAIL}: ${JSON.stringify(created.body)}`)
}

async function rowCount(table, userId) {
  const column = table === 'profiles' ? 'id' : 'user_id'
  const result = await admin(`/rest/v1/${table}?${column}=eq.${userId}&deleted_at=is.null&select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  })
  if (!result.ok) throw new Error(`Counting ${table} failed with ${result.status}`)
  return Number(result.headers.get('content-range')?.split('/')[1] ?? 0)
}

async function markOnboarded(userId) {
  const result = await admin('/rest/v1/profiles?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: userId,
      display_name: 'Demo',
      onboarding_version: ONBOARDING_VERSION,
      onboarded_at: new Date().toISOString(),
    }),
  })
  if (!result.ok) throw new Error(`Marking the profile onboarded failed: ${JSON.stringify(result.body)}`)
}

async function startServer() {
  const server = spawn(
    'npx',
    ['vite', '--config', 'apps/macros/vite.config.ts', 'apps/macros', '--port', String(PORT), '--strictPort'],
    { env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey }, stdio: 'ignore' },
  )
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const isReady = await fetch(`http://localhost:${PORT}/app/`).then(
      (response) => response.ok,
      () => false,
    )
    if (isReady) return server
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  server.kill()
  throw new Error('The dev server did not start')
}

function runAppSeed() {
  const script = fileURLToPath(new URL('./seed-demo.mjs', import.meta.url))
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script], {
      env: { ...process.env, APP_URL: `http://localhost:${PORT}/app/`, DEMO_EMAIL: EMAIL, DEMO_PASSWORD: password },
      stdio: 'inherit',
    })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed-demo.mjs exited with ${code}`))))
  })
}

const userId = await demoUserId()
console.log(`Demo user ${EMAIL} is ${userId}`)
if ((await rowCount('log_entries', userId)) > 0) {
  console.log('The demo account already has logs; leaving them as they are.')
} else {
  await markOnboarded(userId)
  const server = await startServer()
  try {
    await runAppSeed()
  } finally {
    server.kill()
  }
}
for (const table of ['profiles', 'programs', 'log_entries', 'body_weights', 'water_logs', 'recipes']) {
  console.log(`${table}: ${await rowCount(table, userId)}`)
}
