import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "..");
const backendDir = path.resolve(frontendDir, "..", "backend");
const embeddedPythonDir = path.join(frontendDir, "embedded-python");
const requirementsFile = path.join(backendDir, "python-requirements.txt");

function run(command, args, cwd = frontendDir) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function rmTree(targetPath) {
  fs.rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 15,
    retryDelay: 300,
  });
}

function canRun(command, args = ["--version"]) {
  try {
    const result = spawnSync(command, args, {
      cwd: frontendDir,
      stdio: "ignore",
      windowsHide: true,
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function choosePythonLauncher() {
  const unixCandidates = [
    { command: "python3", args: [] },
    { command: "python", args: [] },
  ];
  for (const candidate of unixCandidates) {
    if (canRun(candidate.command, ["--version"])) return candidate;
  }
  return null;
}

function getVenvPythonPath() {
  if (process.platform === "win32") {
    return path.join(embeddedPythonDir, "Scripts", "python.exe");
  }
  return path.join(embeddedPythonDir, "bin", "python3");
}

function findEmbeddedPythonExecutable() {
  const candidatesExe = [
    path.join(embeddedPythonDir, "python.exe"),
    path.join(embeddedPythonDir, "Scripts", "python.exe"),
    path.join(embeddedPythonDir, "python", "install", "python.exe"),
    path.join(embeddedPythonDir, "python", "install", "bin", "python.exe"),
    path.join(embeddedPythonDir, "bin", "python3"),
    path.join(embeddedPythonDir, "bin", "python"),
  ];
  return candidatesExe.find((p) => fs.existsSync(p)) || null;
}

function hasWorkingEmbeddedPython() {
  const pythonExe = findEmbeddedPythonExecutable();
  if (!pythonExe) return false;
  return canRun(pythonExe, [
    "-c",
    "import numpy,librosa,scipy,sklearn,soundfile;print('ok')",
  ]);
}

function downloadFile(url, destination) {
  const response = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `Invoke-WebRequest -UseBasicParsing -Uri "${url}" -OutFile "${destination}"`,
  ], {
    cwd: frontendDir,
    stdio: "inherit",
    windowsHide: true,
  });
  return response.status === 0;
}

function setupWindowsStandalonePython() {
  const pythonVersion = "3.11.7";
  const buildDate = "20240107";
  const releaseBase = `https://github.com/indygreg/python-build-standalone/releases/download/${buildDate}`;
  const candidates = [
    `${releaseBase}/cpython-${pythonVersion}+${buildDate}-x86_64-pc-windows-msvc-install_only.zip`,
    `${releaseBase}/cpython-${pythonVersion}+${buildDate}-x86_64-pc-windows-msvc-shared-install_only.zip`,
    `${releaseBase}/cpython-${pythonVersion}+${buildDate}-x86_64-pc-windows-msvc-install_only.tar.gz`,
    `${releaseBase}/cpython-${pythonVersion}+${buildDate}-x86_64-pc-windows-msvc-shared-install_only.tar.gz`,
  ];

  const archivePath = path.join(frontendDir, "python-standalone.zip");
  const extractDir = path.join(frontendDir, "python-standalone-extract");

  rmTree(embeddedPythonDir);
  fs.rmSync(archivePath, { force: true });
  rmTree(extractDir);
  fs.mkdirSync(extractDir, { recursive: true });

  let downloaded = false;
  let downloadedUrl = "";
  for (const url of candidates) {
    console.log(`Trying Python archive: ${url}`);
    if (downloadFile(url, archivePath)) {
      downloaded = true;
      downloadedUrl = url;
      break;
    }
  }

  if (!downloaded) {
    throw new Error("Could not download a compatible standalone Python build for Windows.");
  }

  if (downloadedUrl.endsWith(".zip")) {
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${extractDir}" -Force`,
    ], frontendDir);
  } else {
    run("tar", ["-xzf", archivePath, "-C", extractDir], frontendDir);
  }

  fs.rmSync(archivePath, { force: true });

  const topEntries = fs.readdirSync(extractDir, { withFileTypes: true });
  if (topEntries.length === 1 && topEntries[0].isDirectory()) {
    fs.cpSync(path.join(extractDir, topEntries[0].name), embeddedPythonDir, { recursive: true });
  } else {
    fs.cpSync(extractDir, embeddedPythonDir, { recursive: true });
  }

  rmTree(extractDir);

  const pythonExe = findEmbeddedPythonExecutable();
  if (!pythonExe) {
    throw new Error(`Embedded Python executable not found under ${embeddedPythonDir}`);
  }

  run(pythonExe, ["--version"], frontendDir);
  run(pythonExe, ["-m", "pip", "install", "--upgrade", "pip"], frontendDir);
  run(pythonExe, ["-m", "pip", "install", "-r", requirementsFile], frontendDir);
  run(pythonExe, ["-c", "import numpy,librosa,scipy,sklearn,soundfile;print('embedded-python-ok')"], frontendDir);
}

console.log("Setting up embedded Python runtime...");

if (!fs.existsSync(requirementsFile)) {
  console.error(`Missing requirements file: ${requirementsFile}`);
  process.exit(1);
}

if (hasWorkingEmbeddedPython()) {
  console.log(`Embedded Python already initialized at: ${embeddedPythonDir}`);
  process.exit(0);
}

if (process.platform === "win32") {
  setupWindowsStandalonePython();
} else {
  const launcher = choosePythonLauncher();
  if (!launcher) {
    console.error("No Python interpreter found. Install Python 3.10+ and retry.");
    process.exit(1);
  }

  console.log(`Using Python launcher: ${launcher.command} ${launcher.args.join(" ")}`.trim());

  fs.rmSync(embeddedPythonDir, { recursive: true, force: true });
  run(launcher.command, [...launcher.args, "-m", "venv", embeddedPythonDir], frontendDir);

  const venvPython = getVenvPythonPath();
  if (!fs.existsSync(venvPython)) {
    console.error(`Embedded Python executable not found after venv creation: ${venvPython}`);
    process.exit(1);
  }

  run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], frontendDir);
  run(venvPython, ["-m", "pip", "install", "-r", requirementsFile], frontendDir);
  run(venvPython, ["-c", "import numpy,librosa,scipy,sklearn,soundfile;print('embedded-python-ok')"], frontendDir);
}

console.log(`Embedded Python ready at: ${embeddedPythonDir}`);
