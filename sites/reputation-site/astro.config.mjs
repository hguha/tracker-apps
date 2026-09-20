import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Static output: the whole site is content, so there is nothing to render per
// request and nothing to keep warm.
export default defineConfig({
  site: 'https://reputation.fitness',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // What the shared components in @tracker-engine/site-kit read their brand facts from.
        '@site': fileURLToPath(new URL('./src/site.ts', import.meta.url)),
      },
    },
    // The kit ships `.astro` sources rather than a build. Astro would otherwise externalise a
    // bare-specifier import and hand Node a file it cannot parse.
    ssr: { noExternal: ['@tracker-engine/site-kit'] },
  },
})
