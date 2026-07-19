import readline from 'readline';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname, basename } from 'path';
import { homedir } from 'os';
import {
  getToken, getAllSettings, getSetting, setSetting, saveLastSession, loadLastSession,
} from './config.js';
import { runLoginFlow } from './auth.js';
import {
  c, mascot, mountainScene, twoColumnBox, divider, terminalWidth, clearScreen, padToBottom,
  startThinkingSpinner, openPath, enableSlashCommandHighlight,
} from './ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const SUPABASE_URL = 'https://pwdncixmwxedfhtiwpmt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cli-chat`;
const VERSION = pkg.version;

// Every slash command recognized inside interactiveChat's rl.on('line', ...)
// handler below — kept in one place so the live input-highlighting knows
// exactly the same set of "valid" commands the handler itself checks for.
const KNOWN_SLASH_COMMANDS = [
  'file', 'attach', 'output', 'open', 'continue', 'config', 'usage',
  'commands', 'help', 'search', 'image', 'doc', 'music',
];

// Keep in sync with the server-side cap in supabase/functions/cli-chat/index.ts.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
};
const EXT_BY_IMAGE_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function fetchAccountInfo(token) {
  const payload = decodeJwt(token);
  const email = payload?.email ?? 'unknown';
  const userId = payload?.sub;
  let isPro = false;

  if (userId) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=is_pro&id=eq.${userId}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const rows = await res.json();
        isPro = !!rows?.[0]?.is_pro;
      }
    } catch {
      // Fails silently — plan just won't show if this network call fails.
    }
  }

  return { email, isPro };
}

// The logged-out splash: title and version on one edge-aligned line, then
// the mountain-and-mascot motif stretched across the terminal — shown
// before we know whether to start a session or point the user at
// `quecksilver login`. Clears the screen first so it lands flush against
// the top of the window, the same way Claude Code's own splash does.
function printWelcomeBanner() {
  clearScreen();
  const width = terminalWidth({ min: 60, max: 96 });
  console.log();
  console.log(c('Welcome to QueckSilver AI', 'steelBlue') + c('  ·  ', 'gray') + c(`v${VERSION}`, 'gray'));
  console.log();
  console.log(mountainScene(width).join('\n'));
  console.log();
}

// Keeps a long path from blowing out the stats box: shows the tail (the
// most useful part — the current folder) with a leading "…" once it no
// longer fits the given budget.
function fitPath(path, maxLen) {
  if (path.length <= maxLen) return path;
  return '…' + path.slice(path.length - (maxLen - 1));
}

// The logged-in welcome panel: one continuous bordered rectangle split by a
// single vertical rule — stats (mascot, greeting, model/plan/version,
// email/dir) on the left, the mountain motif continuing into the same
// rectangle's free space on the right — shown once per session start
// instead of the splash above. Left width is derived from the (fixed-ish)
// stat text itself rather than guessed as a percentage of the terminal, so
// it can never grow past its slot and steal space back from the motif on
// narrow terminals; right width is whatever's left, which is exactly what
// twoColumnBox is told to draw, so the box can never overflow either.
function printWelcomePanel({ email, isPro }) {
  clearScreen();
  const plan = isPro ? 'Pro' : 'Free';
  const rawName = email.split('@')[0] || 'there';
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  const total = terminalWidth({ min: 80, max: 140 });
  // Non-content characters twoColumnBox always draws: left border + left
  // padding*2 + divider + right padding*2 + right border = 1+2+1+2+1.
  const structureOverhead = 7;
  const rightMinContent = 22;

  // One stat per line with aligned labels ("Model:   ", "Version: ", ...)
  // reads far better than cramming everything onto two dot-separated
  // lines — the box's height is already set by the (much taller) mountain
  // column next to it, so there's no vertical-space reason to cram.
  const labelWidth = Math.max('Model'.length, 'Plan'.length, 'Version'.length, 'Email'.length, 'Dir'.length) + 2;
  const minValueWidth = 30;
  const leftContentWidth = Math.max(
    labelWidth + minValueWidth,
    Math.min(56, total - structureOverhead - rightMinContent),
  );
  const rightContentWidth = total - structureOverhead - leftContentWidth;

  const dirDisplay = fitPath(process.cwd(), Math.max(8, leftContentWidth - labelWidth));
  const statRow = (label, value) => c(`${label}:`.padEnd(labelWidth), 'gray') + value;

  const leftLines = [
    '', // breathing room between the "QueckSilver CLI" title and the mascot
    ...mascot().split('\n'),
    '',
    c(`Welcome back, ${name}!`, 'bold'),
    statRow('Model', c('Zora 6.1', 'steelBlue')),
    statRow('Plan', c(plan, 'steelBlue')),
    statRow('Version', `v${VERSION}`),
    statRow('Email', email),
    statRow('Dir', dirDisplay),
  ];
  const rightLines = mountainScene(rightContentWidth, { border: false });

  const output = twoColumnBox(leftLines, rightLines, {
    color: 'steelBlue', title: 'QueckSilver CLI',
    leftWidth: leftContentWidth, rightWidth: rightContentWidth,
  });
  console.log(output);
  console.log();
  return output.split('\n').length + 1; // +1 for the trailing blank line above
}

function parseSettingValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function printSettings(settings) {
  console.log(c('Settings:', 'gray'));
  for (const [key, value] of Object.entries(settings)) {
    console.log(c(`  ${key} = ${value}`, 'gray'));
  }
}

async function printUsage(token) {
  const account = await fetchAccountInfo(token);
  const plan = account.isPro ? 'QueckSilver Pro' : 'QueckSilver Free';
  console.log(c(`Plan: ${plan}`, 'gray'));
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/check-usage`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (res.ok) {
      const data = await res.json();
      console.log(c(`Service status: ${data.sleeping ? 'temporarily limited (daily budget reached)' : 'normal'} (${data.percentUsed}% of today's shared budget used)`, 'gray'));
    } else {
      console.log(c(`(Service status unavailable: HTTP ${res.status})`, 'gray'));
    }
  } catch {
    // Best-effort — usage info just won't show if this fails.
  }
  console.log(c('CLI rate limits: 10 chat requests / min, 20 generations (image/document/music) / 15 min.', 'gray'));
}

// Simple numeric-segment comparison — good enough for x.y.z versions,
// no need for a full semver dependency in a deliberately dependency-free CLI.
function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Fire-and-forget: never blocks or fails startup, just prints a hint if a
// newer version is published.
async function checkForUpdate() {
  try {
    const res = await fetch('https://registry.npmjs.org/quecksilver-cli/latest', { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && isNewerVersion(data.version, VERSION)) {
      console.log(c(`Update available: v${VERSION} → v${data.version} — run npm install -g quecksilver-cli@latest`, 'yellow'));
      console.log();
    }
  } catch {
    // Silent — registry hiccups should never affect normal use.
  }
}

// Reads local files given via --file/-f into the {name, mimeType, data}
// shape cli-chat expects. Unrecognized extensions default to text/plain,
// which covers most code files (.js, .py, .go, ...) without an exhaustive list.
function guessMimeType(path) {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT[ext] || 'text/plain';
}

function readAttachments(paths) {
  return paths.map((path) => {
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
    const size = statSync(path).size;
    if (size > MAX_FILE_BYTES) {
      throw new Error(`File too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB): ${path}`);
    }
    return {
      name: basename(path),
      mimeType: guessMimeType(path),
      data: readFileSync(path).toString('base64'),
    };
  });
}

// Resolves once with the piped content, or null immediately if stdin is a
// real terminal (nothing piped in) — so it never blocks interactive mode.
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(null); return; }
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(null));
  });
}

const EXT_BY_AUDIO_MIME = {
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
};

// Saves image/document/audio attachments from a cli-chat response to
// ~/quecksilver/{images,documents,music}/ and returns the saved paths.
// Opens each one in the OS default app afterward if `open` is true or the
// user has autoOpen enabled in their config.
function saveAttachments(attachments, { open } = {}) {
  const shouldOpen = open ?? getSetting('autoOpen');
  const saved = [];
  for (const att of attachments || []) {
    let filePath;
    if (att.kind === 'image') {
      const dir = join(homedir(), 'quecksilver', 'images');
      mkdirSync(dir, { recursive: true });
      const ext = EXT_BY_IMAGE_MIME[att.mimeType] || '.png';
      filePath = join(dir, `image-${Date.now()}${ext}`);
    } else if (att.kind === 'document') {
      const dir = join(homedir(), 'quecksilver', 'documents');
      mkdirSync(dir, { recursive: true });
      filePath = join(dir, att.filename || `document-${Date.now()}`);
    } else if (att.kind === 'audio') {
      const dir = join(homedir(), 'quecksilver', 'music');
      mkdirSync(dir, { recursive: true });
      const ext = EXT_BY_AUDIO_MIME[att.mimeType] || '.wav';
      filePath = join(dir, `music-${Date.now()}${ext}`);
    } else {
      continue;
    }
    writeFileSync(filePath, Buffer.from(att.base64, 'base64'));
    saved.push(filePath);
    if (shouldOpen) openPath(filePath);
  }
  return saved;
}

function printSources(sources) {
  if (!sources || sources.length === 0) return;
  console.log(c('Sources:', 'gray'));
  sources.forEach((s, i) => console.log(c(`  [${i + 1}] ${s.title} — ${s.url}`, 'gray')));
}

function printSavedPaths(paths) {
  paths.forEach((p) => console.log(c(`Saved: ${p}`, 'gray')));
}

// Full command reference — shown on demand via /commands (in-chat) or
// `quecksilver --commands` (from the shell), not dumped on every startup.
const COMMAND_SECTIONS = [
  {
    heading: 'Start-up flags (quecksilver --flag ...):',
    rows: [
      ['--search "query"', 'Force a web search'],
      ['--image "prompt"', 'Generate or edit an image (with -f attached)'],
      ['--doc <type> "topic"', 'Generate a document (docx/xlsx/pptx/pdf/markdown/csv)'],
      ['--music "prompt"', 'Generate a short music track'],
      ['-f, --file <path>', 'Attach a local file (repeatable)'],
      ['-o, --output <path>', 'Also save the reply to a file'],
      ['--open', 'Auto-open generated files'],
      ['-c, --continue', 'Resume the last local session'],
      ['--json', 'Machine-readable output for scripting'],
    ],
  },
  {
    heading: 'Subcommands:',
    rows: [
      ['login / logout', 'Sign in / out'],
      ['config / config set k v', 'Show or change settings'],
      ['usage', 'Show plan and rate limits'],
      ['--version, -v', 'Show the installed CLI version'],
    ],
  },
  {
    heading: 'Slash commands (while chatting):',
    rows: [
      ['/search, /image, /doc <type> <topic>, /music', 'Force a tool'],
      ['/file <path>', 'Attach a file to your next message'],
      ['/output <path>', 'Save your next reply to a file'],
      ['/open', 'Toggle auto-open for this session'],
      ['/continue', 'Merge the last session into this one'],
      ['/config, /usage', 'Same as the subcommands above'],
    ],
  },
];

// Command tokens print in blue, descriptions in gray — same visual split as
// the live /-highlighting while typing, so the reference list and the live
// input use the same "this is a command" color language.
export function printCommandList() {
  const colWidth = Math.max(...COMMAND_SECTIONS.flatMap((s) => s.rows.map(([cmd]) => cmd.length))) + 2;
  COMMAND_SECTIONS.forEach((section, i) => {
    if (i > 0) console.log();
    console.log(c(section.heading, 'gray'));
    section.rows.forEach(([cmd, desc]) => {
      console.log(`  ${c(cmd.padEnd(colWidth), 'blue')}${c(desc, 'gray')}`);
    });
  });
}

// Directly invokes one tool server-side (bypasses Zora's own tool choice) —
// backs the /search, /image, /doc and /music slash commands (and their
// --search/--image/--doc/--music startup-flag equivalents). `files` carries
// any pending attachments — e.g. an image to use as a create_image edit
// reference.
async function askForcedTool(forceTool, token, files = []) {
  const spinner = startThinkingSpinner();

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ forceTool, files }),
    });
  } catch (err) {
    spinner.stop();
    throw err;
  }

  if (response.status === 401) {
    spinner.stop();
    console.log(c('Session expired. Run "quecksilver login" to sign in again.', 'red'));
    process.exit(1);
  }

  if (response.status === 429) {
    spinner.stop();
    console.log(c('Too many requests. Wait a bit and try again.', 'yellow'));
    process.exit(1);
  }

  if (!response.ok) {
    spinner.stop();
    const errBody = await response.json().catch(() => ({}));
    console.error(c(`Error: ${response.status} ${errBody.error || response.statusText}`, 'red'));
    process.exit(1);
  }

  const data = await response.json();
  spinner.stop();

  return {
    reply: data.reply || '(no reply received)',
    attachments: data.attachments || [],
    sources: data.sources || [],
  };
}

async function askQuecksilver(prompt, history, token, files = [], { quiet = false } = {}) {
  const spinner = quiet ? null : startThinkingSpinner();
  const start = Date.now();

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, history, files }),
    });
  } catch (err) {
    spinner?.stop();
    throw err;
  }

  if (response.status === 401) {
    spinner?.stop();
    console.log(c('Session expired. Run "quecksilver login" to sign in again.', 'red'));
    process.exit(1);
  }

  if (response.status === 429) {
    spinner?.stop();
    console.log(c('Too many requests. Wait a bit and try again.', 'yellow'));
    process.exit(1);
  }

  if (!response.ok) {
    spinner?.stop();
    const errBody = await response.json().catch(() => ({}));
    console.error(c(`Error: ${response.status} ${errBody.error || response.statusText}`, 'red'));
    process.exit(1);
  }

  const data = await response.json();
  const elapsed = Math.max(1, Math.round((Date.now() - start) / 1000));
  const tokenPart = data.usage?.totalTokens ? ` · ${data.usage.totalTokens} tokens` : '';
  spinner?.stop(c(`✓ thought for ${elapsed}s${tokenPart}`, 'dim'));

  return {
    reply: data.reply || '(no reply received)',
    attachments: data.attachments || [],
    sources: data.sources || [],
    usage: data.usage || null,
  };
}

// Streaming variant of askQuecksilver: prints text as it arrives instead of
// waiting for the full reply. Used for the normal (non --json) terminal UX;
// --json keeps using the buffered askQuecksilver above since a single JSON
// blob is simpler and more robust to parse for scripting.
async function askQuecksilverStream(prompt, history, token, files = [], { prefix = '' } = {}) {
  const spinner = startThinkingSpinner();
  const start = Date.now();

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, history, files, stream: true }),
    });
  } catch (err) {
    spinner.stop();
    throw err;
  }

  if (response.status === 401) {
    spinner.stop();
    console.log(c('Session expired. Run "quecksilver login" to sign in again.', 'red'));
    process.exit(1);
  }

  if (response.status === 429) {
    spinner.stop();
    console.log(c('Too many requests. Wait a bit and try again.', 'yellow'));
    process.exit(1);
  }

  if (!response.ok) {
    spinner.stop();
    const errBody = await response.json().catch(() => ({}));
    console.error(c(`Error: ${response.status} ${errBody.error || response.statusText}`, 'red'));
    process.exit(1);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullReply = '';
  let started = false;
  let spinnerStopped = false;
  let final = null;

  const stopSpinner = () => {
    if (!spinnerStopped) { spinner.stop(); spinnerStopped = true; }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let ni;
    while ((ni = buf.indexOf('\n\n')) !== -1) {
      const line = buf.slice(0, ni).trim();
      buf = buf.slice(ni + 2);
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;
      let evt;
      try { evt = JSON.parse(jsonStr); } catch { continue; }

      if (evt.error) {
        stopSpinner();
        console.error(c(`Error: ${evt.error}`, 'red'));
      } else if (evt.text) {
        if (!started) {
          stopSpinner();
          started = true;
          process.stdout.write('\n' + prefix);
        }
        process.stdout.write(evt.text);
        fullReply += evt.text;
      } else if (evt.done) {
        final = evt;
      }
    }
  }

  stopSpinner();
  if (started) process.stdout.write('\n');

  const elapsed = Math.max(1, Math.round((Date.now() - start) / 1000));
  const tokenPart = final?.usage?.totalTokens ? ` · ${final.usage.totalTokens} tokens` : '';
  console.log(c(`✓ thought for ${elapsed}s${tokenPart}`, 'dim'));

  return {
    reply: fullReply || '(no reply received)',
    attachments: final?.attachments || [],
    sources: final?.sources || [],
    usage: final?.usage || null,
  };
}

async function oneOff(prompt, token, { files = [], output, json, open, history = [] } = {}) {
  const result = json
    ? await askQuecksilver(prompt, history, token, files, { quiet: true })
    : await askQuecksilverStream(prompt, history, token, files);

  if (json) {
    console.log(JSON.stringify(result));
  } else {
    printSources(result.sources);
  }

  const saved = saveAttachments(result.attachments, { open });
  if (!json) printSavedPaths(saved);

  if (output) {
    writeFileSync(output, result.reply, 'utf-8');
    if (!json) console.log(c(`Saved reply to ${output}`, 'gray'));
  }

  saveLastSession([...history, { role: 'user', text: prompt }, { role: 'model', text: result.reply }]);
}

// Startup-flag equivalent of the /search, /image, /doc, /music slash
// commands (--search/--image/--doc/--music) — a single forced-tool call
// with no interactive session.
async function oneOffForcedTool(forceTool, token, { files = [], output, json, open } = {}) {
  const result = await askForcedTool(forceTool, token, files);

  if (json) {
    console.log(JSON.stringify(result));
  } else {
    console.log('\n' + result.reply);
    printSources(result.sources);
  }

  const saved = saveAttachments(result.attachments, { open });
  if (!json) printSavedPaths(saved);

  if (output) {
    writeFileSync(output, result.reply, 'utf-8');
    if (!json) console.log(c(`Saved reply to ${output}`, 'gray'));
  }
}

async function interactiveChat(token, { files = [], open, initialHistory = [], usedLines = 0 } = {}) {
  let lines = usedLines;
  console.log(c('Type your message and press Enter to chat. Type "exit" to quit, or /commands to see everything else you can do.', 'gray'));
  console.log();
  lines += 2;

  const promptText = c('you> ', 'steelBlue');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: promptText,
  });
  enableSlashCommandHighlight(rl, promptText, KNOWN_SLASH_COMMANDS);
  const history = [...initialHistory];
  if (initialHistory.length > 0) {
    console.log(c(`Resumed previous session (${initialHistory.length / 2} turn(s)).`, 'gray'));
    console.log();
    lines += 2;
  }
  let pendingFiles = files;
  let pendingOutput = null;
  let sessionOpen = open ?? getSetting('autoOpen');

  const stripQuotes = (s) => s.trim().replace(/^"(.*)"$/, '$1');

  // Shared tail for both the forced-tool and normal chat paths: print
  // sources/saved attachments, honor a queued /output path, record the turn
  // in history so follow-up questions can reference it, and persist the
  // growing history so --continue/-c can pick it up later.
  const finishTurn = (text, result) => {
    printSources(result.sources);
    printSavedPaths(saveAttachments(result.attachments, { open: sessionOpen }));
    if (pendingOutput) {
      writeFileSync(pendingOutput, result.reply, 'utf-8');
      console.log(c(`Saved reply to ${pendingOutput}`, 'gray'));
      pendingOutput = null;
    }
    history.push({ role: 'user', text });
    history.push({ role: 'model', text: result.reply });
    saveLastSession(history);
  };

  // Frames the input with a horizontal rule above it (drawn here, right
  // before the prompt appears) and another below it (drawn the moment the
  // line is submitted, closing off what was just typed).
  //
  // A rule pre-drawn *below* the input before typing starts would be nicer,
  // but Node's readline always redraws by moving to the start of its own
  // render and clearing everything below (on prompt(), and again on every
  // backspace) — it has no way to know a line we drew ourselves is there on
  // purpose, so it gets wiped the moment the user edits the line. Tested
  // this directly: the bottom rule survived the initial prompt() call but
  // vanished on backspace, which is worse than not having it. Closing the
  // box on submit instead is the reliable version of the same idea.
  const promptNext = () => {
    console.log(divider());
    rl.prompt();
  };

  // Push the first prompt down to the terminal's bottom row instead of
  // leaving it stranded right under the welcome panel with a wall of
  // unused space below — only for this very first prompt; once the
  // conversation is scrolling, natural terminal flow takes over.
  padToBottom(lines);
  promptNext();

  rl.on('line', async (line) => {
    console.log(divider());
    const text = line.trim();
    if (!text) { promptNext(); return; }
    if (text === 'exit' || text === 'quit') { rl.close(); return; }

    const fileCmd = text.match(/^\/(?:file|attach)\s+(.+)$/i);
    if (fileCmd) {
      const rawPath = stripQuotes(fileCmd[1]);
      try {
        const [attached] = readAttachments([rawPath]);
        pendingFiles = [...pendingFiles, attached];
        console.log(c(`Attached: ${attached.name} (will be sent with your next message)`, 'gray'));
      } catch (err) {
        console.log(c(err.message, 'red'));
      }
      promptNext();
      return;
    }

    const outputCmd = text.match(/^\/output\s+(.+)$/i);
    if (outputCmd) {
      pendingOutput = stripQuotes(outputCmd[1]);
      console.log(c(`Your next reply will also be saved to ${pendingOutput}`, 'gray'));
      promptNext();
      return;
    }

    if (/^\/open$/i.test(text)) {
      sessionOpen = !sessionOpen;
      console.log(c(`Auto-open is now ${sessionOpen ? 'on' : 'off'} for this session.`, 'gray'));
      promptNext();
      return;
    }

    if (/^\/continue$/i.test(text)) {
      const previous = loadLastSession();
      if (previous.length === 0) {
        console.log(c('No previous session found.', 'gray'));
      } else {
        history.unshift(...previous);
        console.log(c(`Loaded ${previous.length / 2} previous turn(s) into this conversation.`, 'gray'));
      }
      promptNext();
      return;
    }

    const configCmd = text.match(/^\/config(?:\s+set\s+(\S+)\s+(\S+))?$/i);
    if (configCmd) {
      if (configCmd[1]) {
        setSetting(configCmd[1], parseSettingValue(configCmd[2]));
        console.log(c(`${configCmd[1]} = ${configCmd[2]}`, 'gray'));
      } else {
        printSettings(getAllSettings());
      }
      promptNext();
      return;
    }

    if (/^\/usage$/i.test(text)) {
      await printUsage(token);
      promptNext();
      return;
    }

    if (/^\/(?:commands|help)$/i.test(text)) {
      printCommandList();
      promptNext();
      return;
    }

    const searchCmd = text.match(/^\/search\s+(.+)$/i);
    const imageCmd = text.match(/^\/image\s+(.+)$/i);
    const docCmd = text.match(/^\/doc\s+(docx|xlsx|pptx|pdf|markdown|csv)\s+(.+)$/i);
    const musicCmd = text.match(/^\/music\s+(.+)$/i);

    if (searchCmd || imageCmd || docCmd || musicCmd) {
      const forceTool = searchCmd
        ? { name: 'web_search', args: { query: searchCmd[1] } }
        : imageCmd
          ? { name: 'create_image', args: { prompt: imageCmd[1] } }
          : musicCmd
            ? { name: 'create_music', args: { prompt: musicCmd[1] } }
            : { name: 'create_document', args: { doc_type: docCmd[1].toLowerCase(), topic: docCmd[2] } };

      try {
        const result = await askForcedTool(forceTool, token, pendingFiles);
        pendingFiles = [];
        console.log('\n' + c('zora> ', 'bold') + result.reply + '\n');
        finishTurn(text, result);
      } catch (err) {
        console.error(c(`Connection error: ${err.message}`, 'red'));
      }
      promptNext();
      return;
    }

    try {
      const result = await askQuecksilverStream(text, history, token, pendingFiles, { prefix: c('zora> ', 'bold') });
      pendingFiles = [];
      console.log();
      finishTurn(text, result);
    } catch (err) {
      console.error(c(`Connection error: ${err.message}`, 'red'));
    }

    promptNext();
  });

  rl.on('close', () => {
    console.log('\nSee you soon!');
    process.exit(0);
  });
}

// Shared "start a session" step: shows the account panel, then drops into
// either a forced-tool call, a one-off answer, or the interactive chat loop.
async function startSession(token, options) {
  let usedLines = 0;
  if (!options.json) {
    const [account] = await Promise.all([
      fetchAccountInfo(token),
      getSetting('checkUpdates') ? checkForUpdate() : Promise.resolve(),
    ]);
    usedLines = printWelcomePanel(account);
  }

  let files = [];
  try {
    files = readAttachments(options.files || []);
  } catch (err) {
    console.log(c(err.message, 'red'));
    process.exit(1);
  }

  const stdinText = await readStdin();
  if (stdinText && stdinText.trim()) {
    files.push({ name: 'stdin', mimeType: 'text/plain', data: Buffer.from(stdinText, 'utf-8').toString('base64') });
  }

  if (options.forceTool) {
    await oneOffForcedTool(options.forceTool, token, { files, output: options.output, json: options.json, open: options.open });
    return;
  }

  const continuedHistory = options.continueSession ? loadLastSession() : [];
  if (options.continueSession && !options.json) {
    console.log(c(
      continuedHistory.length > 0
        ? `Resumed previous session (${continuedHistory.length / 2} turn(s)).`
        : 'No previous session found — starting fresh.',
      'gray',
    ));
    console.log();
    usedLines += 2;
  }

  let prompt = (options.promptArgs || []).join(' ').trim();
  if (!prompt && files.length > 0) {
    prompt = 'Please analyze the attached content.';
  }

  if (prompt) {
    await oneOff(prompt, token, {
      files, output: options.output, json: options.json, open: options.open, history: continuedHistory,
    });
  } else {
    await interactiveChat(token, { files, open: options.open, initialHistory: continuedHistory, usedLines });
  }
}

// `quecksilver` with no subcommand: shows the banner, and either starts
// chatting (already logged in) or tells the user to run `quecksilver login`.
export async function main(options) {
  const token = getToken();

  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Not logged in. Run "quecksilver login".' }));
      process.exit(1);
    }
    printWelcomeBanner();
    console.log(c('You are not logged in yet.', 'yellow'));
    console.log(`Run ${c('quecksilver login', 'steelBlue')} to sign in and get started.`);
    console.log();
    return;
  }

  await startSession(token, options);
}

// `quecksilver login`: runs the browser auth flow, then prints a clear
// confirmation and next step.
export async function loginCommand() {
  let token;
  try {
    token = await runLoginFlow();
  } catch (err) {
    console.log(c(`Login failed: ${err.message}`, 'red'));
    process.exit(1);
  }

  console.log(c('Login successful.', 'green'));
  console.log(`Run ${c('quecksilver', 'steelBlue')} to start chatting.`);
  process.exit(0);
}

// `quecksilver config` / `quecksilver config set <key> <value>`.
export async function configCommand(args) {
  if (args[0] === 'set' && args[1] && args[2] !== undefined) {
    setSetting(args[1], parseSettingValue(args[2]));
    console.log(`${args[1]} = ${args[2]}`);
  } else {
    printSettings(getAllSettings());
  }
}

// `quecksilver usage` — plan, global service status, and the CLI's own
// rate limits.
export async function usageCommand() {
  const token = getToken();
  if (!token) {
    console.log('You are not logged in yet. Run "quecksilver login" first.');
    process.exit(1);
  }
  await printUsage(token);
}
