#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { main, loginCommand } from '../src/index.js';
import { clearToken } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// Splits out --file/-f (repeatable), --output/-o and --json from the rest of
// the argv, which is joined back together as the prompt text — same as
// before this option parsing existed.
function parseArgs(argv) {
  const files = [];
  let output = null;
  let json = false;
  const promptArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      const path = argv[++i];
      if (path) files.push(path);
    } else if (arg === '--output' || arg === '-o') {
      output = argv[++i] ?? null;
    } else if (arg === '--json') {
      json = true;
    } else {
      promptArgs.push(arg);
    }
  }

  return { files, output, json, promptArgs };
}

if (args[0] === '--version' || args[0] === '-v') {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  console.log(`quecksilver-cli v${pkg.version}`);
} else if (args[0] === 'login') {
  loginCommand();
} else if (args[0] === 'logout') {
  clearToken();
  console.log('Logged out.');
} else {
  main(parseArgs(args));
}
