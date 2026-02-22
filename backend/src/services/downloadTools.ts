import { spawn } from 'child_process'

export type DownloadTool = 'yt-dlp' | 'spotdl'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const installInFlight = new Map<DownloadTool, Promise<void>>()
const availableTools = new Set<DownloadTool>()

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === null || value.trim() === '') return fallback
  return TRUTHY.has(value.trim().toLowerCase())
}

const AUTO_INSTALL_ALL = parseBooleanEnv(process.env.AUTO_INSTALL_DOWNLOAD_TOOLS, false)
const SPOTIFY_IMPORT_ENABLED = parseBooleanEnv(process.env.ENABLE_SPOTIFY_IMPORT, true)
const AUTO_INSTALL_BY_TOOL: Record<DownloadTool, boolean> = {
  'yt-dlp': parseBooleanEnv(process.env.AUTO_INSTALL_YTDLP, AUTO_INSTALL_ALL),
  spotdl: parseBooleanEnv(process.env.AUTO_INSTALL_SPOTDL, AUTO_INSTALL_ALL),
}

const AUTO_INSTALL_HINT_BY_TOOL: Record<DownloadTool, string> = {
  'yt-dlp': 'Set AUTO_INSTALL_YTDLP=1 (or AUTO_INSTALL_DOWNLOAD_TOOLS=1)',
  spotdl: 'Set AUTO_INSTALL_SPOTDL=1 (or AUTO_INSTALL_DOWNLOAD_TOOLS=1)',
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const proc = spawn(command, ['--version'], {
      stdio: 'ignore',
    })

    proc.on('error', (error) => {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        settle(false)
        return
      }
      settle(true)
    })

    proc.on('close', () => {
      settle(true)
    })
  })
}

function runInstallCommand(tool: DownloadTool): Promise<void> {
  const packageName = tool === 'yt-dlp' ? 'yt-dlp' : 'spotdl'
  return new Promise((resolve, reject) => {
    const proc = spawn('pip', ['install', '--no-cache-dir', '--upgrade', packageName], {
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      console.log(`[tools:${tool}] ${text.trim()}`)
    })

    proc.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      console.log(`[tools:${tool}] ${text.trim()}`)
    })

    proc.on('error', (error) => {
      reject(error)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      reject(new Error(`Failed to install ${tool} (exit code ${code}). ${output}`))
    })
  })
}

async function ensureToolAvailableInternal(tool: DownloadTool): Promise<void> {
  if (tool === 'spotdl' && !SPOTIFY_IMPORT_ENABLED) {
    throw new Error('spotdl support is disabled by ENABLE_SPOTIFY_IMPORT=0.')
  }

  if (availableTools.has(tool)) {
    return
  }

  if (await commandExists(tool)) {
    availableTools.add(tool)
    return
  }

  if (!AUTO_INSTALL_BY_TOOL[tool]) {
    throw new Error(
      `${tool} is not installed. ${AUTO_INSTALL_HINT_BY_TOOL[tool]} and restart the backend, or install it manually.`
    )
  }

  console.log(`[tools] ${tool} is missing. Installing automatically...`)
  await runInstallCommand(tool)

  if (!(await commandExists(tool))) {
    throw new Error(`Automatic install reported success, but ${tool} is still unavailable.`)
  }

  availableTools.add(tool)
  console.log(`[tools] ${tool} is ready.`)
}

export async function ensureDownloadTool(tool: DownloadTool): Promise<void> {
  if (availableTools.has(tool)) {
    return
  }

  const pending = installInFlight.get(tool)
  if (pending) {
    return pending
  }

  const installPromise = ensureToolAvailableInternal(tool).finally(() => {
    installInFlight.delete(tool)
  })

  installInFlight.set(tool, installPromise)
  return installPromise
}
