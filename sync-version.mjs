#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const version = readFileSync(resolve(__dirname, 'VERSION'), 'utf8').trim();

const packageFiles = [
  resolve(__dirname, 'backend/package.json'),
  resolve(__dirname, 'frontend/package.json'),
];

for (const file of packageFiles) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.version === version) {
    console.log(`${file}: already at ${version}`);
    continue;
  }
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${file}: updated to ${version}`);
}
