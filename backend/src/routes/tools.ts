import { Router, type Request, type Response } from 'express'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const router = Router()
const execAsync = promisify(exec)

type DependencyGroup = 'web' | 'electron'
type DependencyTarget = DependencyGroup | 'all'
type DependencyField = 'dependencies' | 'devDependencies' | 'unknown'

interface OutdatedDependency {
  name: string
  current: string | null
  wanted: string | null
  latest: string | null
  dependencyType: DependencyField
  group: DependencyGroup
}

interface DependencyGroupStatus {
  total: number
  outdated: number
  upToDate: boolean
  packages: OutdatedDependency[]
}

interface FrontendDependencyStatusResponse {
  available: boolean
  frontendDir: string | null
  checkedAt: string
  message?: string
  groups: {
    web: DependencyGroupStatus
    electron: DependencyGroupStatus
    all: DependencyGroupStatus
  }
}

interface FrontendPackageManifest {
  packageTypeByName: Map<string, DependencyField>
  groupByName: Map<string, DependencyGroup>
  totals: {
    web: number
    electron: number
    all: number
  }
}

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

interface NpmOutdatedEntry {
  current?: string
  wanted?: string
  latest?: string
  type?: string
}

interface RcloneShareStatusResponse {
  available: boolean
  frontendDir: string | null
  scriptPath: string | null
  configPath: string | null
  scriptExists: boolean
  configExists: boolean
  rcloneVersion: string | null
  message?: string
}

type RcloneShareLibraries = Record<string, {
  latest: string | null
  versions: Array<{
    version: string
    publishedAt: string
    remotePath: string
    fileCount: number
    totalBytes: number
    note?: string | null
  }>
}>

interface RcloneShareCommandResponse {
  success: boolean
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
}

type StreamingProcess = ReturnType<typeof spawn>

const ELECTRON_PACKAGE_PATTERNS = [
  /^electron$/,
  /^electron-builder$/,
  /^@electron\//,
  /^cross-env$/,
  /^concurrently$/,
  /^wait-on$/,
]
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const DEFAULT_RCLONE_SHARE_REMOTE = ':local:/app/data/rclone-share-remote'
const DEFAULT_RCLONE_SHARE_BASE_PATH = 'sample-share'
const DEFAULT_RCLONE_SHARE_LOCAL_LIBRARY_ROOT = '/app/data/shared-libraries'

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value || value.trim() === '') return fallback
  return TRUTHY.has(value.trim().toLowerCase())
}

const SPOTIFY_IMPORT_ENABLED = parseBooleanEnv(process.env.ENABLE_SPOTIFY_IMPORT, true)
const RCLONE_SHARE_AUTO_SETUP = parseBooleanEnv(process.env.RCLONE_SHARE_AUTO_SETUP, true)

function createEmptyDependencyGroupStatus(total = 0): DependencyGroupStatus {
  return {
    total,
    outdated: 0,
    upToDate: true,
    packages: [],
  }
}

function createEmptyDependencyStatus(frontendDir: string | null, message?: string): FrontendDependencyStatusResponse {
  return {
    available: false,
    frontendDir,
    checkedAt: new Date().toISOString(),
    message,
    groups: {
      web: createEmptyDependencyGroupStatus(0),
      electron: createEmptyDependencyGroupStatus(0),
      all: createEmptyDependencyGroupStatus(0),
    },
  }
}

function isElectronDependency(packageName: string): boolean {
  return ELECTRON_PACKAGE_PATTERNS.some((pattern) => pattern.test(packageName))
}

function resolveFrontendProjectDir(): string | null {
  const candidates = [
    process.env.FRONTEND_PROJECT_DIR,
    path.resolve(process.cwd(), '../frontend'),
    path.resolve(process.cwd(), 'frontend'),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate))

  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)

    const packageJsonPath = path.join(candidate, 'package.json')
    if (!fs.existsSync(packageJsonPath)) continue

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
        name?: string
        scripts?: Record<string, string>
      }

      const looksLikeFrontendProject =
        packageJson.name === 'sample-extractor-frontend' ||
        typeof packageJson.scripts?.['dev:electron'] === 'string'

      if (looksLikeFrontendProject) {
        return candidate
      }
    } catch {
      // Try next candidate
    }
  }

  return null
}

function resolveRcloneShareProjectDir(): string | null {
  const frontendDir = resolveFrontendProjectDir()
  const candidates = [
    process.env.RCLONE_SHARE_PROJECT_DIR,
    frontendDir,
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate))

  const seen = new Set<string>()
  for (const rawCandidate of candidates) {
    const candidate = path.isAbsolute(rawCandidate)
      ? rawCandidate
      : path.resolve(process.cwd(), rawCandidate)

    if (seen.has(candidate)) continue
    seen.add(candidate)

    try {
      const stats = fs.statSync(candidate)
      if (stats.isDirectory()) return candidate
    } catch {
      // Try next candidate
    }
  }

  return null
}

function buildDefaultRcloneShareConfig() {
  const remote = process.env.RCLONE_SHARE_REMOTE?.trim() || DEFAULT_RCLONE_SHARE_REMOTE
  const basePath = process.env.RCLONE_SHARE_BASE_PATH?.trim() || DEFAULT_RCLONE_SHARE_BASE_PATH
  const localLibraryRoot = process.env.RCLONE_SHARE_LOCAL_LIBRARY_ROOT?.trim() || DEFAULT_RCLONE_SHARE_LOCAL_LIBRARY_ROOT
  const rcloneBinary = process.env.RCLONE_SHARE_BINARY?.trim() || 'rclone'

  return {
    remote,
    basePath,
    localLibraryRoot,
    rcloneBinary,
  }
}

function ensureRcloneShareConfig(configPath: string): void {
  if (fs.existsSync(configPath)) return

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const defaults = buildDefaultRcloneShareConfig()
  fs.writeFileSync(configPath, `${JSON.stringify(defaults, null, 2)}\n`, 'utf-8')
}

function resolveRcloneSharePaths() {
  const projectDir = resolveRcloneShareProjectDir()
  if (!projectDir) {
    return {
      frontendDir: null,
      scriptPath: null,
      configPath: null,
      scriptExists: false,
      configExists: false,
    }
  }

  const configuredScriptPath = process.env.RCLONE_SHARE_SCRIPT
  const scriptPath = configuredScriptPath
    ? (path.isAbsolute(configuredScriptPath)
      ? configuredScriptPath
      : path.resolve(process.cwd(), configuredScriptPath))
    : path.join(projectDir, 'scripts', 'rclone-share.mjs')

  const configuredPath = process.env.RCLONE_SHARE_CONFIG
  const configPath = configuredPath
    ? (path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath))
    : path.join(projectDir, 'rclone-share.config.json')

  if (RCLONE_SHARE_AUTO_SETUP) {
    try {
      ensureRcloneShareConfig(configPath)
    } catch {
      // Keep status reporting deterministic even when auto-setup cannot write.
    }
  }

  return {
    frontendDir: projectDir,
    scriptPath,
    configPath,
    scriptExists: fs.existsSync(scriptPath),
    configExists: fs.existsSync(configPath),
  }
}

function loadFrontendManifest(frontendDir: string): FrontendPackageManifest {
  const packageJsonPath = path.join(frontendDir, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const packageTypeByName = new Map<string, DependencyField>()
  const groupByName = new Map<string, DependencyGroup>()

  for (const packageName of Object.keys(packageJson.dependencies ?? {})) {
    packageTypeByName.set(packageName, 'dependencies')
    groupByName.set(packageName, isElectronDependency(packageName) ? 'electron' : 'web')
  }

  for (const packageName of Object.keys(packageJson.devDependencies ?? {})) {
    if (!packageTypeByName.has(packageName)) {
      packageTypeByName.set(packageName, 'devDependencies')
    }
    if (!groupByName.has(packageName)) {
      groupByName.set(packageName, isElectronDependency(packageName) ? 'electron' : 'web')
    }
  }

  const totals = {
    web: 0,
    electron: 0,
    all: packageTypeByName.size,
  }

  for (const group of groupByName.values()) {
    if (group === 'electron') {
      totals.electron += 1
    } else {
      totals.web += 1
    }
  }

  return { packageTypeByName, groupByName, totals }
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('error', (error) => {
      reject(error)
    })

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
}

function parseOutdatedJson(rawOutput: string): Record<string, NpmOutdatedEntry> {
  const trimmed = rawOutput.trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed) as Record<string, NpmOutdatedEntry>
}

function toGroupStatus(total: number, packages: OutdatedDependency[]): DependencyGroupStatus {
  return {
    total,
    outdated: packages.length,
    upToDate: packages.length === 0,
    packages,
  }
}

async function checkFrontendDependencies(frontendDir: string): Promise<FrontendDependencyStatusResponse> {
  try {
    const manifest = loadFrontendManifest(frontendDir)
    const outdatedResult = await runCommand('npm', ['outdated', '--json'], frontendDir)

    if (
      outdatedResult.code !== 0 &&
      outdatedResult.code !== 1
    ) {
      throw new Error(
        `npm outdated failed (exit code ${outdatedResult.code ?? 'unknown'}). ${outdatedResult.stderr.trim()}`
      )
    }

    if (outdatedResult.code === 1 && !outdatedResult.stdout.trim()) {
      throw new Error(outdatedResult.stderr.trim() || 'npm outdated failed to return JSON output')
    }

    const outdatedPackages = Object.entries(parseOutdatedJson(outdatedResult.stdout))
      .map(([name, entry]): OutdatedDependency => {
        const dependencyTypeFromManifest = manifest.packageTypeByName.get(name)
        const dependencyType =
          dependencyTypeFromManifest ??
          (entry.type === 'dependencies' || entry.type === 'devDependencies'
            ? entry.type
            : 'unknown')

        return {
          name,
          current: entry.current ?? null,
          wanted: entry.wanted ?? null,
          latest: entry.latest ?? null,
          dependencyType,
          group: manifest.groupByName.get(name) ?? 'web',
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const webPackages = outdatedPackages.filter((pkg) => pkg.group === 'web')
    const electronPackages = outdatedPackages.filter((pkg) => pkg.group === 'electron')

    return {
      available: true,
      frontendDir,
      checkedAt: new Date().toISOString(),
      groups: {
        web: toGroupStatus(manifest.totals.web, webPackages),
        electron: toGroupStatus(manifest.totals.electron, electronPackages),
        all: toGroupStatus(manifest.totals.all, outdatedPackages),
      },
    }
  } catch (error) {
    return createEmptyDependencyStatus(
      frontendDir,
      error instanceof Error ? error.message : 'Failed to check frontend dependencies',
    )
  }
}

function formatCommandOutput(commandDescription: string, result: CommandResult): string {
  const lines = [
    `$ ${commandDescription}`,
    result.stdout.trim(),
    result.stderr.trim(),
    `Exit code: ${result.code ?? 'unknown'}`,
  ].filter(Boolean)
  return lines.join('\n')
}

function createRcloneShareCommandResponse(
  commandArgs: string[],
  result: CommandResult
): RcloneShareCommandResponse {
  return {
    success: result.code === 0,
    command: commandArgs.join(' '),
    exitCode: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

function parseRcloneShareLibraries(stdout: string): RcloneShareLibraries {
  const trimmed = stdout.trim()
  if (!trimmed) return {}

  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('rclone-share list returned invalid JSON.')
  }

  return parsed as RcloneShareLibraries
}

async function runRcloneShare(
  command: string,
  args: string[]
): Promise<{
  commandArgs: string[]
  result: CommandResult
}> {
  const paths = resolveRcloneSharePaths()
  if (!paths.frontendDir || !paths.scriptPath) {
    throw new Error('rclone-share project directory not found. Set RCLONE_SHARE_PROJECT_DIR if needed.')
  }

  if (!paths.scriptExists) {
    throw new Error(`rclone-share script not found at ${paths.scriptPath}`)
  }

  if (!paths.configExists) {
    throw new Error(`rclone-share config not found at ${paths.configPath}`)
  }

  const commandArgs = [
    'node',
    paths.scriptPath,
    command,
    ...args,
    '--config',
    paths.configPath,
  ]
  const result = await runCommand(
    commandArgs[0],
    commandArgs.slice(1),
    paths.frontendDir,
  )

  return { commandArgs, result }
}

function sendRcloneShareError(
  res: Response,
  error: unknown,
  fallback: string,
) {
  const message = error instanceof Error ? error.message : fallback
  const lower = message.toLowerCase()
  const statusCode = (
    lower.includes('not found') ||
    lower.includes('missing') ||
    lower.includes('required')
  )
    ? 400
    : 500

  res.status(statusCode).json({ error: message })
}

async function updateFrontendDependencies(frontendDir: string, target: DependencyTarget) {
  const before = await checkFrontendDependencies(frontendDir)
  if (!before.available) {
    throw new Error(before.message || 'Dependency checker is unavailable')
  }

  const packagesForTarget = before.groups.all.packages.filter((pkg) => {
    if (target === 'all') return true
    return pkg.group === target
  })

  if (packagesForTarget.length === 0) {
    return {
      target,
      updatedPackages: [] as OutdatedDependency[],
      output: 'All selected dependencies are already up to date.',
      status: before,
    }
  }

  const dependencyPackages = Array.from(
    new Set(
      packagesForTarget
        .filter((pkg) => pkg.dependencyType === 'dependencies' || pkg.dependencyType === 'unknown')
        .map((pkg) => `${pkg.name}@latest`)
    )
  )

  const devDependencyPackages = Array.from(
    new Set(
      packagesForTarget
        .filter((pkg) => pkg.dependencyType === 'devDependencies')
        .map((pkg) => `${pkg.name}@latest`)
    )
  )

  const outputChunks: string[] = []

  if (dependencyPackages.length > 0) {
    const result = await runCommand('npm', ['install', ...dependencyPackages], frontendDir)
    outputChunks.push(
      formatCommandOutput(
        `npm install ${dependencyPackages.join(' ')}`,
        result,
      ),
    )
    if (result.code !== 0) {
      throw new Error(`Failed updating dependencies.\n\n${outputChunks.join('\n\n')}`)
    }
  }

  if (devDependencyPackages.length > 0) {
    const result = await runCommand(
      'npm',
      ['install', '--save-dev', ...devDependencyPackages],
      frontendDir
    )
    outputChunks.push(
      formatCommandOutput(
        `npm install --save-dev ${devDependencyPackages.join(' ')}`,
        result,
      ),
    )
    if (result.code !== 0) {
      throw new Error(`Failed updating devDependencies.\n\n${outputChunks.join('\n\n')}`)
    }
  }

  const after = await checkFrontendDependencies(frontendDir)
  if (!after.available) {
    throw new Error(after.message || 'Dependency check failed after update')
  }

  return {
    target,
    updatedPackages: packagesForTarget,
    output: outputChunks.join('\n\n'),
    status: after,
  }
}

async function getInstalledVersion(tool: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`${tool} --version`)
    return stdout.trim().split('\n')[0].trim()
  } catch {
    return null
  }
}

async function getLatestYtdlpVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
      { headers: { 'User-Agent': 'sample-solution-app' } }
    )
    if (!response.ok) return null
    const data = (await response.json()) as any
    return data.tag_name
  } catch {
    return null
  }
}

async function getLatestSpotdlVersion(): Promise<string | null> {
  try {
    const response = await fetch('https://pypi.org/pypi/spotdl/json')
    if (!response.ok) return null
    const data = (await response.json()) as any
    return data.info.version
  } catch {
    return null
  }
}

function terminateStreamingProcess(proc: StreamingProcess) {
  if (proc.killed) return

  proc.kill('SIGTERM')
  const killTimer = setTimeout(() => {
    if (!proc.killed) {
      proc.kill('SIGKILL')
    }
  }, 2000)
  killTimer.unref?.()
}

function streamPipToolUpdate(
  req: Request,
  res: Response,
  packageName: string
) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('X-Accel-Buffering', 'no')

  const proc = spawn('pip', ['install', '--no-cache-dir', '--upgrade', packageName])
  let finalized = false

  const finalize = () => {
    if (finalized) return
    finalized = true
    req.off('aborted', onAbort)
    req.off('close', onClose)
  }

  const onAbort = () => {
    if (finalized) return
    terminateStreamingProcess(proc)
  }

  const onClose = () => {
    if (res.writableEnded) return
    onAbort()
  }

  req.on('aborted', onAbort)
  req.on('close', onClose)

  proc.stdout.on('data', (d) => {
    if (!res.writableEnded) {
      res.write(d.toString())
    }
  })

  proc.stderr.on('data', (d) => {
    if (!res.writableEnded) {
      res.write(d.toString())
    }
  })

  proc.on('error', (error) => {
    finalize()
    if (res.writableEnded) return
    res.write(`\nUpdate failed: ${error.message}`)
    res.end()
  })

  proc.on('close', (code, signal) => {
    finalize()
    if (res.writableEnded) return

    if (signal) {
      res.write(`\nStopped (${signal})`)
      res.end()
      return
    }

    res.write(`\nDone (exit code ${code})`)
    res.end()
  })
}

// GET /tools/versions — check current and latest versions
router.get('/versions', async (_req, res) => {
  const [ytdlpCurrent, spotdlCurrent, ytdlpLatest, spotdlLatest] = await Promise.all([
    getInstalledVersion('yt-dlp'),
    SPOTIFY_IMPORT_ENABLED ? getInstalledVersion('spotdl') : Promise.resolve(null),
    getLatestYtdlpVersion(),
    SPOTIFY_IMPORT_ENABLED ? getLatestSpotdlVersion() : Promise.resolve(null),
  ])

  res.json({
    ytdlp: { current: ytdlpCurrent, latest: ytdlpLatest },
    spotdl: { current: spotdlCurrent, latest: spotdlLatest },
  })
})

// GET /tools/dependencies/status — check frontend dependency update status
router.get('/dependencies/status', async (_req, res) => {
  const frontendDir = resolveFrontendProjectDir()
  if (!frontendDir) {
    res.json(
      createEmptyDependencyStatus(
        null,
        'Frontend project directory not found. Dependency checks are unavailable in this environment.',
      )
    )
    return
  }

  const status = await checkFrontendDependencies(frontendDir)
  res.json(status)
})

// POST /tools/dependencies/update/:target — update web/electron/all frontend dependencies
router.post('/dependencies/update/:target', async (req, res) => {
  const target = req.params.target as DependencyTarget

  if (!['web', 'electron', 'all'].includes(target)) {
    res.status(400).json({ error: 'Invalid target. Use one of: web, electron, all.' })
    return
  }

  const frontendDir = resolveFrontendProjectDir()
  if (!frontendDir) {
    res.status(404).json(
      createEmptyDependencyStatus(
        null,
        'Frontend project directory not found. Dependency updates are unavailable in this environment.',
      )
    )
    return
  }

  try {
    const result = await updateFrontendDependencies(frontendDir, target)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update frontend dependencies',
    })
  }
})

// POST /tools/update/ytdlp — install/update yt-dlp via pip
router.post('/update/ytdlp', (req, res) => {
  streamPipToolUpdate(req, res, 'yt-dlp')
})

// POST /tools/update/spotdl — update spotdl via pip
router.post('/update/spotdl', (req, res) => {
  if (!SPOTIFY_IMPORT_ENABLED) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  streamPipToolUpdate(req, res, 'spotdl')
})

// GET /tools/rclone-share/status — check local/frontend integration readiness
router.get('/rclone-share/status', async (_req, res) => {
  const paths = resolveRcloneSharePaths()
  const rcloneVersion = await getInstalledVersion('rclone')

  let message: string | undefined
  if (!paths.frontendDir) {
    message = 'rclone-share project directory not found.'
  } else if (!paths.scriptExists) {
    message = `rclone-share script not found at ${paths.scriptPath}.`
  } else if (!paths.configExists) {
    message = `Config file missing at ${paths.configPath}.`
  } else if (!rcloneVersion) {
    message = 'rclone is not installed or not available in PATH.'
  }

  const response: RcloneShareStatusResponse = {
    available: Boolean(paths.frontendDir && paths.scriptExists && paths.configExists && rcloneVersion),
    frontendDir: paths.frontendDir,
    scriptPath: paths.scriptPath,
    configPath: paths.configPath,
    scriptExists: paths.scriptExists,
    configExists: paths.configExists,
    rcloneVersion,
    message,
  }

  res.json(response)
})

// GET /tools/rclone-share/list?name=
router.get('/rclone-share/list', async (req, res) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : ''
    const args = ['--json']
    if (name) {
      args.push('--name', name)
    }

    const { commandArgs, result } = await runRcloneShare('list', args)
    const response = createRcloneShareCommandResponse(commandArgs, result)

    if (!response.success) {
      res.status(400).json(response)
      return
    }

    const libraries = parseRcloneShareLibraries(response.stdout)
    res.json({ ...response, libraries })
  } catch (error) {
    sendRcloneShareError(res, error, 'Failed to list shared libraries')
  }
})

// POST /tools/rclone-share/init
router.post('/rclone-share/init', async (_req, res) => {
  try {
    const { commandArgs, result } = await runRcloneShare('init', [])
    const response = createRcloneShareCommandResponse(commandArgs, result)
    if (!response.success) {
      res.status(400).json(response)
      return
    }
    res.json(response)
  } catch (error) {
    sendRcloneShareError(res, error, 'Failed to initialize rclone share')
  }
})

// POST /tools/rclone-share/publish
router.post('/rclone-share/publish', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const source = typeof req.body?.source === 'string' ? req.body.source.trim() : ''
    const version = typeof req.body?.version === 'string' ? req.body.version.trim() : ''
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''

    if (!name || !source) {
      res.status(400).json({ error: 'name and source are required.' })
      return
    }

    const args = ['--name', name, '--source', source]
    if (version) args.push('--version', version)
    if (note) args.push('--note', note)

    const { commandArgs, result } = await runRcloneShare('publish', args)
    const response = createRcloneShareCommandResponse(commandArgs, result)
    if (!response.success) {
      res.status(400).json(response)
      return
    }
    res.json(response)
  } catch (error) {
    sendRcloneShareError(res, error, 'Failed to publish shared library')
  }
})

// POST /tools/rclone-share/pull
router.post('/rclone-share/pull', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const version = typeof req.body?.version === 'string' ? req.body.version.trim() : ''
    const target = typeof req.body?.target === 'string' ? req.body.target.trim() : ''

    if (!name) {
      res.status(400).json({ error: 'name is required.' })
      return
    }

    const args = ['--name', name]
    if (version) args.push('--version', version)
    if (target) args.push('--target', target)

    const { commandArgs, result } = await runRcloneShare('pull', args)
    const response = createRcloneShareCommandResponse(commandArgs, result)
    if (!response.success) {
      res.status(400).json(response)
      return
    }
    res.json(response)
  } catch (error) {
    sendRcloneShareError(res, error, 'Failed to pull shared library')
  }
})

// POST /tools/rclone-share/sync
router.post('/rclone-share/sync', async (req, res) => {
  try {
    const targetRoot = typeof req.body?.targetRoot === 'string' ? req.body.targetRoot.trim() : ''
    const args = targetRoot ? ['--target-root', targetRoot] : []

    const { commandArgs, result } = await runRcloneShare('sync', args)
    const response = createRcloneShareCommandResponse(commandArgs, result)
    if (!response.success) {
      res.status(400).json(response)
      return
    }
    res.json(response)
  } catch (error) {
    sendRcloneShareError(res, error, 'Failed to sync shared libraries')
  }
})

export default router
