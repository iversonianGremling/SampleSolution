import 'dotenv/config'
import path from 'path'
import { createApp } from './app.js'

const PORT = process.env.PORT || 4000
const DATA_DIR = process.env.DATA_DIR || './data'

const app = createApp()

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Data directory: ${path.resolve(DATA_DIR)}`)
})
