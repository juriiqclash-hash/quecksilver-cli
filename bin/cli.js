#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { main, loginCommand, configCommand, usageCommand } from '../src/index.js';
import { clearToken } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// Splits out --file/-f (repeatable), --output/-o, --json, --open,
// --continue/-c and the forced-tool flags (--search/--image/--doc/--music)
// from the rest of the argv, which is joined back together as the prompt
// text — same as before this option parsing existed. A forced-tool flag
// consumes every remaining argument as its own text (query/prompt/topic),
// so it must come last.
function parseArgs(argv) {
  const files = [];
  let output = null;
  let json = false;
  let open = false;
  let continueSession = false;
  let forceTool = null;
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
    } else if (arg === '--open') {
      open = true;
    } else if (arg === '--continue' || arg === '-c') {
      continueSession = true;
    } else if (arg === '--search') {
      forceTool = { name: 'web_search', args: { query: argv.slice(i + 1).join(' ') } };
      break;
    } else if (arg === '--image') {
      forceTool = { name: 'create_image', args: { prompt: argv.slice(i + 1).join(' ') } };
      break;
    } else if (arg === '--music') {
      forceTool = { name: 'create_music', args: { prompt: argv.slice(i + 1).join(' ') } };
      break;
    } else if (arg === '--doc') {
      const docType = (argv[i + 1] || '').toLowerCase();
      const topic = argv.slice(i + 2).join(' ');
      forceTool = { name: 'create_document', args: { doc_type: docType, topic } };
      break;
    } else {
      promptArgs.push(arg);
    }
  }

  return { files, output, json, open, continueSession, forceTool, promptArgs };
}

if (args[0] === '--version' || args[0] === '-v') {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  console.log(`quecksilver-cli v${pkg.version}`);
} else if (args[0] === 'login') {
  loginCommand();
} else if (args[0] === 'logout') {
  clearToken();
  console.log('Logged out.');
} else if (args[0] === 'config') {
  configCommand(args.slice(1));
} else if (args[0] === 'usage') {
  usageCommand();
} else {
  main(parseArgs(args));
}
