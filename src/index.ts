import { Elysia } from 'elysia'

const app = new Elysia()
  .get('/', () => Bun.file('./public/index.html'))
  .get('/manga', () => Bun.file('./public/manga.html'))
  // Serve bundled JS files from public/manga/
  .get('/manga/main.js', () => Bun.file('./public/manga/main.js'))
  // API endpoint to provide Convex URL to frontend
  .get('/manga/config', () => ({
    convexUrl: process.env.CONVEX_URL || ''
  }))
  .listen(3000)

console.log(`Server running at http://localhost:${app.server?.port}`)
console.log(`Manga page: http://localhost:${app.server?.port}/manga`)
