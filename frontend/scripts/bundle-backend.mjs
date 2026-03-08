import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "..");
const backendDir = path.resolve(frontendDir, "..", "backend");
const bundleDir = path.resolve(frontendDir, "embedded-backend");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, cwd) {
  execSync(command, { cwd, stdio: "inherit", env: process.env });
}

function runWithEnv(command, cwd, extraEnv = {}) {
  execSync(command, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

function getBuildPythonPath() {
  const embeddedPythonDir = path.join(frontendDir, "embedded-python");
  const candidates = process.platform === "win32"
    ? [
        path.join(embeddedPythonDir, "Scripts", "python.exe"),
        path.join(embeddedPythonDir, "python.exe"),
        path.join(embeddedPythonDir, "python", "install", "python.exe"),
        path.join(embeddedPythonDir, "python", "install", "bin", "python.exe"),
      ]
    : [
        path.join(embeddedPythonDir, "bin", "python3"),
        path.join(embeddedPythonDir, "bin", "python"),
      ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function rmIfExists(targetPath) {
  try {
    fs.rmSync(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 15,
      retryDelay: 500,
    });
    return;
  } catch (err) {
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      throw err;
    }
  }

  // Windows can keep the directory handle busy. If root delete fails,
  // clear directory contents in place and continue.
  for (const entry of fs.readdirSync(targetPath)) {
    const fullPath = path.join(targetPath, entry);
    fs.rmSync(fullPath, {
      recursive: true,
      force: true,
      maxRetries: 15,
      retryDelay: 500,
    });
  }
}

function fileSizeHuman(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(fullPath);
    else if (entry.isFile()) total += fs.statSync(fullPath).size;
  }
  return total;
}

function writeEmbeddedPackageJson() {
  const packageJson = {
    name: "sample-solution-backend-embedded",
    version: "1.0.0",
    type: "module",
    main: "dist/index.js",
    dependencies: {
      axios: "^1.6.5",
      "better-sqlite3": "^9.3.0",
      cors: "^2.8.5",
      dotenv: "^17.2.3",
      "drizzle-orm": "^0.29.3",
      express: "^4.18.2",
      "express-session": "^1.17.3",
      googleapis: "^130.0.0",
      meyda: "^5.6.3",
      multer: "^2.0.2",
      archiver: "^7.0.1",
      uuid: "^9.0.0",
      "ffmpeg-static": "^5.2.0",
      "ffprobe-static": "^3.1.0",
    },
  };

  fs.writeFileSync(
    path.join(bundleDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
}

function cleanupBetterSqliteArtifacts() {
  const sqliteBuild = path.join(bundleDir, "node_modules", "better-sqlite3", "build");
  if (!fs.existsSync(sqliteBuild)) return;

  rmIfExists(path.join(sqliteBuild, "Release", ".deps"));
  rmIfExists(path.join(sqliteBuild, "Release", "obj"));
  rmIfExists(path.join(sqliteBuild, "Release", "obj.target"));
  rmIfExists(path.join(sqliteBuild, "Release", "test_extension.node"));
  rmIfExists(path.join(sqliteBuild, "Release", ".forge-meta"));
  rmIfExists(path.join(sqliteBuild, "config.gypi"));
  rmIfExists(path.join(sqliteBuild, "gyp-mac-tool"));
}

function maybeFixUnixBinaryPermissions() {
  if (process.platform === "win32") return;

  const ffmpegDir = path.join(bundleDir, "node_modules", "ffmpeg-static");
  const ffprobeDir = path.join(bundleDir, "node_modules", "ffprobe-static");
  if (fs.existsSync(ffmpegDir)) run(`chmod -R u+x "${ffmpegDir}"`, frontendDir);
  if (fs.existsSync(ffprobeDir)) run(`chmod -R u+x "${ffprobeDir}"`, frontendDir);
}

console.log("Bundling backend for Electron embedding...");
console.log("");

if (!fs.existsSync(backendDir)) {
  console.error(`Backend directory not found: ${backendDir}`);
  process.exit(1);
}

console.log("Cleaning previous bundle...");
rmIfExists(bundleDir);
fs.mkdirSync(bundleDir, { recursive: true });

const backendNodeModules = path.join(backendDir, "node_modules");
if (!fs.existsSync(backendNodeModules)) {
  console.log("");
  console.log("Installing backend dependencies...");
  const backendLock = path.join(backendDir, "package-lock.json");
  if (fs.existsSync(backendLock)) {
    run(`${npmCmd} ci --legacy-peer-deps`, backendDir);
  } else {
    run(`${npmCmd} install --legacy-peer-deps`, backendDir);
  }
}

console.log("");
console.log("Building backend...");
run(`${npmCmd} run build`, backendDir);

console.log("");
console.log("Copying backend files...");
fs.cpSync(path.join(backendDir, "dist"), path.join(bundleDir, "dist"), { recursive: true });
console.log("Copied dist/");

const pythonSrcDir = path.join(backendDir, "src", "python");
if (fs.existsSync(pythonSrcDir)) {
  fs.cpSync(pythonSrcDir, path.join(bundleDir, "dist", "python"), { recursive: true });
  console.log("Copied Python scripts");
}

console.log("");
console.log("Creating package.json...");
writeEmbeddedPackageJson();

for (const target of [
  "yamnet.js",
  "yamnet.js.map",
  "yamnet.d.ts",
  "yamnet.d.ts.map",
]) {
  rmIfExists(path.join(bundleDir, "dist", "services", target));
}

console.log("");
console.log("Installing production dependencies...");
const buildPythonPath = getBuildPythonPath();
const buildEnv = buildPythonPath
  ? { PYTHON: buildPythonPath, npm_config_python: buildPythonPath }
  : {};
runWithEnv(`${npmCmd} install --production --legacy-peer-deps`, bundleDir, buildEnv);

console.log("");
console.log("Rebuilding native modules for Electron...");
const electronVersion = execSync(
  `node -e "console.log(require('electron/package.json').version)"`,
  { cwd: frontendDir, encoding: "utf8" },
).trim();
runWithEnv(
  `${npxCmd} @electron/rebuild --module-dir "${bundleDir}" --electron-version "${electronVersion}" --only better-sqlite3`,
  frontendDir,
  buildEnv,
);

console.log("");
console.log("Fixing ffmpeg/ffprobe binary permissions...");
maybeFixUnixBinaryPermissions();

rmIfExists(path.join(bundleDir, "node_modules", "ffmpeg-static", "install.js"));
rmIfExists(path.join(bundleDir, "node_modules", "ffmpeg-static", ".github"));
rmIfExists(path.join(bundleDir, "node_modules", "ffprobe-static", "install.js"));
rmIfExists(path.join(bundleDir, "node_modules", "ffprobe-static", ".github"));

console.log("");
console.log("Cleaning native module build artifacts...");
cleanupBetterSqliteArtifacts();

console.log("");
console.log("Creating .env file...");
const rootEnvPath = path.resolve(frontendDir, "..", ".env");
const rootEnvVars = fs.existsSync(rootEnvPath) ? fs.readFileSync(rootEnvPath, "utf8") : "";
const bundleEnvBase = "PORT=4000\nNODE_ENV=production\n";
fs.writeFileSync(
  path.join(bundleDir, ".env"),
  bundleEnvBase + rootEnvVars,
  "utf8",
);

fs.mkdirSync(path.join(bundleDir, "data"), { recursive: true });
fs.mkdirSync(path.join(bundleDir, "uploads"), { recursive: true });

const size = fileSizeHuman(dirSize(bundleDir));
console.log("");
console.log("Backend bundled successfully!");
console.log(`Location: ${bundleDir}`);
console.log(`Size: ${size}`);
