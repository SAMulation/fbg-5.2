/**
 * Local dev server.
 *   - Static: /public
 *   - Multiplayer relay: WS /api/ws
 *
 * Runs on :3000 by default. `PORT=4000 node server-local.js` to override.
 */

const http = require('http')
const express = require('express')

const app = express()
app.use(express.static('public'))

const server = http.createServer(app)

// Dynamic import so this CJS file can pull in the ESM multiplayer module.
import('./server/multiplayer.mjs').then(({ attachMultiplayer }) => {
  attachMultiplayer(server)

  const port = process.env.PORT || 3000
  server.listen(port, () => {
    console.log(`FBG running on http://localhost:${port}`)
    console.log('  Static:       /')
    console.log(`  Multiplayer:  ws://localhost:${port}/api/ws`)
  })
}).catch(err => {
  console.error('Failed to attach multiplayer:', err)
  process.exit(1)
})
