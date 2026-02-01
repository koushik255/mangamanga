import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'

const app = new Elysia()
  // Enable CORS for cross-origin requests from Cloudflare Pages
  .use(cors({
    origin: ['https://koushikkoushik.com', 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }))
  // Health check endpoint
  .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }))
  // API endpoint to provide Convex URL to frontend
  .get('/manga/config', () => ({
    convexUrl: process.env.CONVEX_URL || '',
    backend: 'connected',
    timestamp: new Date().toISOString()
  }))
  // Signal endpoint for frontend button
  .post('/signal', ({ body }) => {
    const timestamp = new Date().toISOString()
    console.log(`📡 Signal received from frontend at: ${timestamp}`)
    console.log(`   Body:`, body)
    return { 
      status: 'received', 
      timestamp,
      message: 'Signal received by backend!'
    }
  })
  // Serve static files (only for local development)
  .get('/', () => Bun.file('./public/index.html'))
  .get('/manga', () => Bun.file('./public/manga.html'))
  .get('/manga/main.js', () => Bun.file('./public/manga/main.js'))
  .listen(3000)

console.log(`🚀 Backend server running at http://localhost:${app.server?.port}`)
console.log(`   Health check: http://localhost:${app.server?.port}/health`)
console.log(`   Config: http://localhost:${app.server?.port}/manga/config`)
console.log(`   Signal endpoint: POST http://localhost:${app.server?.port}/signal`)
