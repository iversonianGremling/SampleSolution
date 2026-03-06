const { spawn } = require('child_process');

let electronBinary;
try {
  electronBinary = require('electron');
} catch (error) {
  console.error('Failed to resolve Electron binary:', error && error.message ? error.message : error);
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: 'development' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env,
  shell: false,
});

child.on('error', (error) => {
  console.error('Failed to launch Electron:', error && error.message ? error.message : error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
    return;
  }
  if (signal) {
    console.error(`Electron exited with signal ${signal}`);
    process.exit(1);
    return;
  }
  process.exit(0);
});
