import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

export type DownloadTool = 'yt-dlp' | 'spotdl'

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const installInFlight = new Map<DownloadTool, Promise<void>>()
const availableTools = new Set<DownloadTool>()

// Cache: tool name → resolved absolute path (or null = use PATH)
const resolvedToolPaths = new Map<DownloadTool, string | null>()

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

/**
 * Returns candidate absolute paths for a tool binary given the Python executable path.
 * pip installs scripts into the same Scripts/ (Windows) or bin/ (Unix) dir as python.
 */
function getCandidateToolPaths(tool: DownloadTool): string[] {
  const pythonPath = process.env.PYTHON_PATH
  if (!pythonPath) return []

  const pythonDir = path.dirname(pythonPath)

  if (process.platform === 'win32') {
    // pip may install into Scripts/ relative to python.exe, or into the same dir
    return [
      path.join(pythonDir, 'Scripts', `${tool}.exe`),
      path.join(pythonDir, 'Scripts', tool),
      path.join(pythonDir, `${tool}.exe`),
      path.join(pythonDir, tool),
    ]
  }

  // Unix: pip installs into bin/ alongside python, or one level up in bin/
  return [
    path.join(pythonDir, tool),
    path.join(path.dirname(pythonDir), 'bin', tool),
  ]
}

/** Resolves the absolute path to a tool, or null if it must be found via PATH. */
function resolveToolPath(tool: DownloadTool): string | null {
  if (resolvedToolPaths.has(tool)) return resolvedToolPaths.get(tool)!

  for (const candidate of getCandidateToolPaths(tool)) {
    if (fs.existsSync(candidate)) {
      resolvedToolPaths.set(tool, candidate)
      return candidate
    }
  }

  resolvedToolPaths.set(tool, null)
  return null
}

export function spawnTool(tool: DownloadTool, args: string[], opts: object = {}) {
  const resolved = resolveToolPath(tool)
  return spawn(resolved ?? tool, args, opts)
}

function commandExists(tool: DownloadTool): Promise<boolean> {
  // Always re-check disk for candidate paths (may have just been installed)
  resolvedToolPaths.delete(tool)
  const resolved = resolveToolPath(tool)

  return new Promise((resolve) => {
    let settled = false
    const settle = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const proc = spawn(resolved ?? tool, ['--version'], { stdio: 'ignore' })

    proc.on('error', (error) => {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        settle(false)
        return
      }
      settle(true)
    })

    proc.on('close', () => { settle(true) })
  })
}

function getPipCommand(): { cmd: string; args: string[] } {
  const pythonPath = process.env.PYTHON_PATH
  if (pythonPath) {
    return { cmd: pythonPath, args: ['-m', 'pip'] }
  }
  return { cmd: process.platform === 'win32' ? 'pip' : 'pip3', args: [] }
}

function runInstallCommand(tool: DownloadTool): Promise<void> {
  const packageName = tool === 'yt-dlp' ? 'yt-dlp' : 'spotdl'
  const { cmd, args } = getPipCommand()
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [...args, 'install', '--no-cache-dir', '--upgrade', packageName], {
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
