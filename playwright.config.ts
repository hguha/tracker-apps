import { defineConfig, devices } from '@playwright/test'

/**
 * Root E2E / regression suite for the monorepo. One project per app; each starts its
 * own Vite dev server and asserts the app boots and a core flow works. This is the
 * "tracker-apps verifies everything" layer that sits above each app's unit tests.
 *
 * First run needs the browser once: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { trace: 'on-first-retry' },

  projects: [
    {
      name: 'reputation',
      testMatch: /reputation\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173/app/' },
    },
    {
      name: 'ledger',
      testMatch: /ledger\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174/' },
    },
  ],

  // Each app's dev server. Playwright waits for the URL before running that project.
  webServer: [
    {
      // No Supabase env, so the suite exercises the local provider and can never
      // send mail or write to the live project. Server-side auth behaviour
      // (confirmation, password sign-in) is verified against the project directly.
      command: 'VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev --workspace reputation',
      url: 'http://localhost:5173/app/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Force mock mode (empty Supabase env overrides apps/ledger/.env) so the E2E is
      // deterministic against the seeded feed + device-only account, not a live project.
      command: 'VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev --workspace ledger',
      url: 'http://localhost:5174/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
