#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { main, loginCommand } from '../src/index.js';
import { clearToken } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args[0] === '--version' || args[0] === '-v') {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  console.log(`quecksilver-cli v${pkg.version}`);
} else if (args[0] === 'login') {
  loginCommand();
} else if (args[0] === 'logout') {
  clearToken();
  console.log('Logged out.');
} else {
  main(args);
}