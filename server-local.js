/**
 * Lightweight static-only dev server. Multiplayer now runs through the
 * Cloudflare Worker in packages/worker (start with `npm run dev`). Use
 * THIS server only for quick static iteration when multiplayer isn't
 * needed: `npm run dev:static`.
 */

const express = require('express')

const app = express()
app.use(express.static('public'))

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`FBG static dev server on http://localhost:${port}`)
  console.log('For multiplayer, use `npm run dev` (Cloudflare Worker).')
})
