#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const HELP_TEXT = `
rclone-share: manage versioned shared libraries over rclone.

Usage:
  node scripts/rclone-share.mjs <command> [options]

Commands:
  init
      Create remote folders and initialize remote index.json if missing.

  publish --name <library> --source <dir> [--version <v>] [--note <text>]
      Sync a local library directory to a versioned remote path and register it.

  list [--name <library>] [--json]
      Show published libraries and versions from the remote manifest.

  pull --name <library> [--version <v>] [--target <dir>]
      Pull one library version from remote to local path.

  sync [--target-root <dir>]
      Pull latest version of every library into the local target root.

  help
      Show this help.

Options:
  --config <path>   Config file path (default: ./rclone-share.config.json)

Config shape:
{
  "remote": "myremote",
  "basePath": "sample-share",
  "localLibraryRoot": "./shared-libraries",
  "rcloneBinary": "rclone"
}

"remote" supports either:
  - rclone alias (for example "myremote")
  - full remote root (for example ":local:/app/data/rclone-share-remote")
`;

function parseCli(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  const positional = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = tokens[i + 1];

    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { command, options, positional };
}

function toPosixPath(...parts) {
  return parts
    .filter(Boolean)
    .map((segment) => segment.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function buildRemotePath(config, ...parts) {
  const relative = toPosixPath(config.basePath, ...parts);
  if (config.remote.includes(':')) {
    const root = config.remote.replace(/\/+$/g, '');
    return relative ? `${root}/${relative}` : root;
  }
  return `${config.remote}:${relative}`;
}

function createEmptyIndex() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    libraries: {}
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, { captureStdout = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: captureStdout ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });

    let stdout = '';
    let stderr = '';

    if (captureStdout && child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (captureStdout && child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      const error = new Error(
        `Command failed (${command} ${args.join(' ')}): ${stderr.trim() || `exit code ${code}`}`
      );
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function isMissingRemoteError(error) {
  const message = `${error?.message ?? ''}\n${error?.stderr ?? ''}`.toLowerCase();
  if (
    message.includes("failed to find section in config file") ||
    message.includes("didn't find section in config file")
  ) {
    return false;
  }

  return (
    message.includes('object not found') ||
    message.includes('directory not found') ||
    message.includes('file not found') ||
    message.includes('does not exist')
  );
}

async function withTempDir(fn) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rclone-share-'));

  try {
    return await fn(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function computeDirectoryStats(dirPath) {
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }

        if (!entry.isFile()) {
          return;
        }

        const stats = await fs.stat(fullPath);
        fileCount += 1;
        totalBytes += stats.size;
      })
    );
  }

  await walk(dirPath);
  return { fileCount, totalBytes };
}

function validateConfig(raw, configPath) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid config in ${configPath}: expected object`);
  }

  const remote = typeof raw.remote === 'string' ? raw.remote.trim() : '';
  const basePath = typeof raw.basePath === 'string' ? raw.basePath.trim() : '';
  const localLibraryRoot =
    typeof raw.localLibraryRoot === 'string' && raw.localLibraryRoot.trim().length > 0
      ? raw.localLibraryRoot
      : './shared-libraries';
  const rcloneBinary =
    typeof raw.rcloneBinary === 'string' && raw.rcloneBinary.trim().length > 0
      ? raw.rcloneBinary
      : 'rclone';

  if (!remote) {
    throw new Error(`Missing required "remote" in ${configPath}.`);
  }

  if (remote.includes(':') && remote.endsWith(':')) {
    throw new Error(
      `Invalid "remote" in ${configPath}. A full remote root cannot end with ":" (for example use ":local:/path").`
    );
  }

  if (!basePath) {
    throw new Error(`Missing required "basePath" in ${configPath}.`);
  }

  return {
    remote,
    basePath: toPosixPath(basePath),
    localLibraryRoot: path.resolve(process.cwd(), localLibraryRoot),
    rcloneBinary
  };
}

async function loadConfig(options) {
  const fromEnv = process.env.RCLONE_SHARE_CONFIG;
  const configuredPath = options.config || fromEnv || './rclone-share.config.json';
  if (configuredPath === true) {
    throw new Error('Option --config requires a file path.');
  }

  const configPath = path.resolve(process.cwd(), configuredPath);

  const exists = await pathExists(configPath);
  if (!exists) {
    throw new Error(
      `Config not found: ${configPath}. Create it from rclone-share.config.example.json first.`
    );
  }

  const rawText = await fs.readFile(configPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Invalid JSON config: ${configPath}. ${error.message}`);
  }

  return validateConfig(parsed, configPath);
}

async function runRclone(config, args, opts = {}) {
  try {
    return await runCommand(config.rcloneBinary, args, opts);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `rclone binary "${config.rcloneBinary}" was not found. Install rclone or set "rcloneBinary" in config.`
      );
    }
    throw error;
  }
}

async function readRemoteIndex(config) {
  const remoteIndexPath = buildRemotePath(config, 'index.json');

  return withTempDir(async (tempDir) => {
    const localIndexPath = path.join(tempDir, 'index.json');

    try {
      await runRclone(config, ['copyto', remoteIndexPath, localIndexPath]);
      const text = await fs.readFile(localIndexPath, 'utf8');
      const parsed = JSON.parse(text);

      if (!parsed || typeof parsed !== 'object' || !parsed.libraries) {
        throw new Error('Remote index.json has invalid structure.');
      }

      return { index: parsed, exists: true };
    } catch (error) {
      if (isMissingRemoteError(error)) {
        return { index: createEmptyIndex(), exists: false };
      }
      throw error;
    }
  });
}

async function writeRemoteIndex(config, index) {
  const remoteIndexPath = buildRemotePath(config, 'index.json');
  const nextIndex = {
    ...index,
    updatedAt: new Date().toISOString()
  };

  await withTempDir(async (tempDir) => {
    const localIndexPath = path.join(tempDir, 'index.json');
    await fs.writeFile(localIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf8');
    await runRclone(config, ['copyto', localIndexPath, remoteIndexPath]);
  });
}

function ensureLibraryEntry(index, libraryName) {
  if (!index.libraries[libraryName]) {
    index.libraries[libraryName] = {
      latest: null,
      versions: []
    };
  }

  return index.libraries[libraryName];
}

function formatVersionTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function commandInit(config) {
  await runRclone(config, ['mkdir', buildRemotePath(config)]);
  await runRclone(config, ['mkdir', buildRemotePath(config, 'libraries')]);

  const { index, exists } = await readRemoteIndex(config);
  if (!exists) {
    await writeRemoteIndex(config, index);
    console.log(`Initialized remote index at ${buildRemotePath(config, 'index.json')}`);
    return;
  }

  console.log(`Remote index already exists at ${buildRemotePath(config, 'index.json')}`);
}

async function commandPublish(config, options) {
  const name = typeof options.name === 'string' ? options.name.trim() : '';
  const source = typeof options.source === 'string' ? path.resolve(process.cwd(), options.source) : '';
  const note = typeof options.note === 'string' ? options.note.trim() : '';

  if (!name) {
    throw new Error('Missing required option: --name <library>');
  }

  if (!source) {
    throw new Error('Missing required option: --source <directory>');
  }

  const sourceExists = await pathExists(source);
  if (!sourceExists) {
    throw new Error(`Source directory not found: ${source}`);
  }

  const sourceStats = await fs.stat(source);
  if (!sourceStats.isDirectory()) {
    throw new Error(`Source must be a directory: ${source}`);
  }

  const version =
    typeof options.version === 'string' && options.version.trim().length > 0
      ? options.version.trim()
      : formatVersionTimestamp();

  const remoteLibraryPath = buildRemotePath(config, 'libraries', name, version);

  const { index } = await readRemoteIndex(config);
  const entry = ensureLibraryEntry(index, name);

  if (entry.versions.some((item) => item.version === version)) {
    throw new Error(
      `Version "${version}" already exists for library "${name}". Use a different --version.`
    );
  }

  const { fileCount, totalBytes } = await computeDirectoryStats(source);

  await runRclone(config, ['mkdir', buildRemotePath(config, 'libraries', name)]);
  await runRclone(config, ['sync', source, remoteLibraryPath]);

  const record = {
    version,
    publishedAt: new Date().toISOString(),
    remotePath: toPosixPath(config.basePath, 'libraries', name, version),
    fileCount,
    totalBytes,
    note: note || null
  };

  entry.latest = version;
  entry.versions.push(record);
  entry.versions.sort((a, b) => a.version.localeCompare(b.version));

  await writeRemoteIndex(config, index);

  console.log(`Published ${name}@${version}`);
  console.log(`Remote path: ${remoteLibraryPath}`);
  console.log(`Files: ${fileCount}, bytes: ${totalBytes}`);
}

function printList(index, libraryName, asJson) {
  let data = index.libraries;
  if (libraryName) {
    data = {};
    if (index.libraries[libraryName]) {
      data[libraryName] = index.libraries[libraryName];
    }
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const names = Object.keys(data);
  if (names.length === 0) {
    console.log('No libraries published yet.');
    return;
  }

  for (const name of names.sort()) {
    const library = data[name];
    const totalVersions = Array.isArray(library.versions) ? library.versions.length : 0;
    console.log(`${name} (latest: ${library.latest ?? 'n/a'}, versions: ${totalVersions})`);
    for (const version of (library.versions ?? []).slice().sort((a, b) => a.version.localeCompare(b.version))) {
      console.log(
        `  - ${version.version} | files=${version.fileCount} | bytes=${version.totalBytes} | published=${version.publishedAt}`
      );
    }
  }
}

async function commandList(config, options) {
  const { index } = await readRemoteIndex(config);
  const name = typeof options.name === 'string' ? options.name.trim() : '';
  printList(index, name || null, Boolean(options.json));
}

function pickVersion(entry, requestedVersion) {
  if (requestedVersion) {
    const found = entry.versions.find((item) => item.version === requestedVersion);
    if (!found) {
      throw new Error(`Version "${requestedVersion}" not found.`);
    }
    return found.version;
  }

  if (!entry.latest) {
    throw new Error('No latest version exists for this library.');
  }

  return entry.latest;
}

async function writeLocalState(targetPath, state) {
  const statePath = path.join(targetPath, '.rclone-share.json');
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function commandPull(config, options) {
  const name = typeof options.name === 'string' ? options.name.trim() : '';
  if (!name) {
    throw new Error('Missing required option: --name <library>');
  }

  const { index } = await readRemoteIndex(config);
  const entry = index.libraries[name];
  if (!entry) {
    throw new Error(`Library "${name}" not found in remote index.`);
  }

  const requestedVersion =
    typeof options.version === 'string' && options.version.trim().length > 0
      ? options.version.trim()
      : '';
  const version = pickVersion(entry, requestedVersion);

  const target =
    typeof options.target === 'string' && options.target.trim().length > 0
      ? path.resolve(process.cwd(), options.target)
      : path.join(config.localLibraryRoot, name);

  await fs.mkdir(target, { recursive: true });

  const remoteLibraryPath = buildRemotePath(config, 'libraries', name, version);
  await runRclone(config, ['sync', remoteLibraryPath, target]);

  await writeLocalState(target, {
    library: name,
    version,
    remotePath: remoteLibraryPath,
    syncedAt: new Date().toISOString()
  });

  console.log(`Pulled ${name}@${version} -> ${target}`);
}

async function commandSync(config, options) {
  const { index } = await readRemoteIndex(config);
  const names = Object.keys(index.libraries).sort();

  if (names.length === 0) {
    console.log('No libraries available to sync.');
    return;
  }

  const targetRoot =
    typeof options['target-root'] === 'string' && options['target-root'].trim().length > 0
      ? path.resolve(process.cwd(), options['target-root'])
      : config.localLibraryRoot;

  await fs.mkdir(targetRoot, { recursive: true });

  for (const name of names) {
    const entry = index.libraries[name];
    if (!entry.latest) {
      continue;
    }

    const version = entry.latest;
    const target = path.join(targetRoot, name);
    await fs.mkdir(target, { recursive: true });

    const remoteLibraryPath = buildRemotePath(config, 'libraries', name, version);
    await runRclone(config, ['sync', remoteLibraryPath, target]);

    await writeLocalState(target, {
      library: name,
      version,
      remotePath: remoteLibraryPath,
      syncedAt: new Date().toISOString()
    });

    console.log(`Synced ${name}@${version} -> ${target}`);
  }
}

async function main() {
  const { command, options } = parseCli(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP_TEXT.trim());
    return;
  }

  const config = await loadConfig(options);

  if (command === 'init') {
    await commandInit(config);
    return;
  }

  if (command === 'publish') {
    await commandPublish(config, options);
    return;
  }

  if (command === 'list') {
    await commandList(config, options);
    return;
  }

  if (command === 'pull') {
    await commandPull(config, options);
    return;
  }

  if (command === 'sync') {
    await commandSync(config, options);
    return;
  }

  throw new Error(`Unknown command: ${command}. Use "help" for usage.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
