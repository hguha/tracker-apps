import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'

// Static output: the whole site is content, so there is nothing to render per
// request and nothing to keep warm.
export default defineConfig({
  site: 'https://reputation.fitness',
  output: 'static',
  vite: { plugins: [tailwindcss()] },
})
