/**
 * electron-builder afterPack hook — ad-hoc code signing for macOS.
 *
 * Why this exists:
 *   The CI release job runs with CSC_IDENTITY_AUTO_DISCOVERY=false and the
 *   project has no Apple Developer ID certificate, so electron-builder does not
 *   reliably sign the macOS app. On Apple Silicon every Mach-O (the app binary,
 *   Electron helpers, and the bundled native modules such as better-sqlite3 and
 *   tfjs-node) MUST carry at least an ad-hoc signature or the OS refuses to load
 *   it — which surfaces to users as "Sample Solution is damaged and can't be
 *   opened."
 *
 *   This hook deterministically ad-hoc signs the app so the arm64 build is
 *   launchable. It does NOT enable the hardened runtime (we cannot notarize
 *   without a paid Developer ID), so Electron's JIT keeps working without extra
 *   entitlements.
 *
 * Note: ad-hoc signing does not remove the download quarantine. Users who
 *   download the app still need to clear it once (see README macOS
 *   troubleshooting) until the project can notarize releases.
 */

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// Mach-O / universal binary magic numbers (read big-endian).
const MACHO_MAGICS = new Set([
  0xfeedface, // 32-bit
  0xfeedfacf, // 64-bit
  0xcefaedfe, // 32-bit, byte-swapped
  0xcffaedfe, // 64-bit, byte-swapped
  0xcafebabe, // fat/universal
  0xbebafeca, // fat/universal, byte-swapped
])

function isMachO(file) {
  if (/\.(node|dylib|so)$/.test(file)) return true
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || !(stat.mode & 0o111)) return false
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(4)
      const bytes = fs.readSync(fd, buf, 0, 4, 0)
      if (bytes < 4) return false
      return MACHO_MAGICS.has(buf.readUInt32BE(0))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

function collectMachO(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMachO(full, out)
    } else if (entry.isFile() && isMachO(full)) {
      out.push(full)
    }
  }
}

function adhocSign(target, extraArgs = []) {
  execFileSync(
    'codesign',
    ['--force', ...extraArgs, '--sign', '-', '--timestamp=none', target],
    { stdio: 'inherit' },
  )
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  if (!fs.existsSync(appPath)) {
    console.warn(`[after-pack-macos] App not found at ${appPath}; skipping ad-hoc signing`)
    return
  }

  console.log(`[after-pack-macos] Ad-hoc signing ${appName}`)

  // 1) Sign nested Mach-O in the bundled backend/python resources first.
  //    codesign --deep does not reliably reach code under Contents/Resources,
  //    so we sign these explicitly, deepest paths first (inside-out).
  const resourceDirs = ['embedded-backend', 'embedded-python']
    .map((dir) => path.join(appPath, 'Contents', 'Resources', dir))
    .filter((dir) => fs.existsSync(dir))

  const nested = []
  for (const dir of resourceDirs) collectMachO(dir, nested)
  nested.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)

  console.log(`[after-pack-macos] Signing ${nested.length} embedded Mach-O binaries`)
  for (const target of nested) adhocSign(target)

  // 2) Deep-sign the app bundle last (Electron framework, helpers, main binary).
  adhocSign(appPath, ['--deep'])

  // 3) Verify the signature is structurally valid (ad-hoc still fails Gatekeeper
  //    assessment, which is expected until releases are notarized).
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
    console.log('[after-pack-macos] codesign --verify passed')
  } catch {
    console.warn('[after-pack-macos] codesign --verify reported issues; continuing (ad-hoc signature)')
  }
}
