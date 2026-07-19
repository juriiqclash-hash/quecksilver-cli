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
  c, mascot, logoArt, twoColumnBox, terminalWidth, clearScreen,
  centerBlock, visibleLength, startThinkingSpinner, openPath, readBoxedInput,
  padToBottom, waitBriefly,
} from './ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const SUPABASE_URL = 'https://pwdncixmwxedfhtiwpmt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cli-chat`;
const VERSION = pkg.version;

// Every slash command recognized inside interactiveChat's input loop
// below — kept in one place so the live input-highlighting knows exactly
// the same set of "valid" commands the loop itself checks for.
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

// The logged-out splash: the QueckSilver wordmark rendered big from a
// baked reference capture (see logo-data.js), with the version underneath
// — shown before we know whether to start a session or point the user at
// `quecksilver login`. Clears the screen first so it lands flush against
// the top of the window, the same way Claude Code's own splash does.
function printWelcomeBanner() {
  clearScreen();
  const width = terminalWidth({ min: 80, max: 200 });
  console.log();
  console.log(c('Welcome to QueckSilver CLI', 'steelBlue') + c(' · ', 'gray') + c(`v${VERSION}`, 'gray'));
  console.log();
  console.log(logoArt(width).join('\n'));
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
// floating vertical rule (it doesn't touch the top/bottom border — see
// `dividerInset` on twoColumnBox) — stats (greeting, mascot,
// model/plan/version/email/dir, all centered as a block) on the left,
// quick tips on the right — shown once per session start instead of the
// splash above. Left width is derived from the (fixed-ish) stat text
// itself rather than guessed as a percentage of the terminal, so it can
// never grow past its slot; right width is derived from the tips' own
// natural width the same way, so the box can never overflow either.
function printWelcomePanel({ email, isPro }) {
  clearScreen();
  const plan = isPro ? 'Pro' : 'Free';
  const rawName = email.split('@')[0] || 'there';
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  const total = terminalWidth({ min: 80, max: 200 });
  // Non-content characters twoColumnBox always draws: left border + left
  // padding*2 + divider + right padding*2 + right border = 1+2+1+2+1.
  const structureOverhead = 7;

  // One stat per line with aligned labels ("Model:   ", "Version: ", ...)
  // reads far better than cramming everything onto one dot-separated line,
  // and centering the whole block (not each line individually) keeps the
  // labels lined up with each other instead of each drifting to its own
  // center.
  const labelWidth = Math.max('Model'.length, 'Plan'.length, 'Version'.length, 'Email'.length, 'Dir'.length) + 3;
  const minValueWidth = 30;
  const mascotWidth = Math.max(...mascot().split('\n').map(visibleLength));
  const leftMinWidth = Math.max(labelWidth + minValueWidth, mascotWidth);

  // The right column only ever takes the width its own text actually needs
  // (clamped to whatever's left after the left column's minimum) — giving
  // it all the remaining terminal width instead just left a big empty
  // gutter next to short lines on a wide terminal. The left column then
  // absorbs whatever's left over, which centerBlock turns into balanced
  // padding around the greeting/mascot/stats instead of a cramped corner.
  const availableForBoth = total - structureOverhead;
  const rightContentWidth = Math.max(
    Math.min(QUICK_TIPS_NATURAL_WIDTH, availableForBoth - leftMinWidth),
    QUICK_TIPS_COL_WIDTH + 4, // still leave room for a few description characters on a narrow terminal
  );
  const leftContentWidth = availableForBoth - rightContentWidth;
  const rightLines = quickTipsLines(rightContentWidth);

  const dirDisplay = fitPath(process.cwd(), Math.max(8, leftContentWidth - labelWidth));
  const statRow = (label, value) => c(`${label}:`.padEnd(labelWidth), 'gray') + value;

  const leftLines = [
    ...centerBlock([c(`Welcome back, ${name}!`, 'bold')], leftContentWidth),
    '',
    ...centerBlock(mascot().split('\n'), leftContentWidth),
    '',
    ...centerBlock([
      statRow('Model', c('Zora 6.1', 'steelBlue')),
      statRow('Plan', c(plan, 'steelBlue')),
      statRow('Version', `v${VERSION}`),
      statRow('Email', email),
      statRow('Dir', dirDisplay),
    ], leftContentWidth),
  ];

  const output = twoColumnBox(leftLines, rightLines, {
    color: 'steelBlue', title: 'QueckSilver CLI',
    leftWidth: leftContentWidth, rightWidth: rightContentWidth,
    dividerInset: 1,
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

// A handful of highlights from COMMAND_SECTIONS — not the full reference
// (that's /commands), just enough to fill the welcome panel's right column
// with something useful to read.
const QUICK_TIPS = [
  ['/image <prompt>', 'Generate or edit an image'],
  ['/search <query>', 'Force a web search'],
  ['/doc <type> <topic>', 'Generate a docx/xlsx/pptx/pdf/markdown/csv'],
  ['/music <prompt>', 'Generate a short music track'],
  ['/file <path>', 'Attach a file to your next message'],
  ['-c, --continue', 'Resume your last session'],
  ['/commands', 'Show the full command reference'],
];
// The command column's fixed width — printWelcomePanel also needs this to
// size the right column wide enough to fit at least a few description
// characters (see rightMinWidth there), not just the commands themselves.
const QUICK_TIPS_COL_WIDTH = Math.max(...QUICK_TIPS.map(([cmd]) => cmd.length)) + 2;

// The right column's actual content width with nothing truncated — used to
// size the panel's right column to what the tips need, rather than letting
// it stretch to fill whatever space is left over on a wide terminal (which
// just reads as a big empty gutter next to short lines).
const QUICK_TIPS_NATURAL_WIDTH = Math.max(
  'Quick tips:'.length,
  ...QUICK_TIPS.map(([cmd, desc]) => QUICK_TIPS_COL_WIDTH + desc.length),
);

// Formats the quick-tips block as plain lines (not printed directly) so it
// can be dropped straight into the welcome panel's right column. Truncates
// each description to fit `maxWidth` — the panel hands this a fixed
// column budget, and unlike the old mountain motif (generated at exactly
// the width asked for) this is fixed text, so on a narrow terminal it has
// to be cut down rather than trusted to already fit.
function quickTipsLines(maxWidth) {
  const colWidth = QUICK_TIPS_COL_WIDTH;
  return [
    c('Quick tips:', 'gray'),
    '',
    ...QUICK_TIPS.map(([cmd, desc]) => {
      const cmdPart = cmd.padEnd(colWidth);
      const maxDesc = Math.max(4, maxWidth - cmdPart.length);
      const shownDesc = desc.length > maxDesc ? `${desc.slice(0, Math.max(1, maxDesc - 1))}…` : desc;
      return `${c(cmdPart, 'blue')}${c(shownDesc, 'gray')}`;
    }),
  ];
}

// The "getting started" callout that replaces the quick-tips block below
// the welcome panel (tips live inside the panel itself now) — a plain
// intro to what this CLI is, styled with a left accent bar like Claude
// Code's own release-notes callout, ending in a link to the full docs.
// Returns how many terminal lines it used, so the caller can fold that
// into its running line count for padToBottom.
const ABOUT_TEXT = 'QueckSilver CLI brings QueckSilver AI (Zora) into your terminal: chat, '
  + 'attach files, generate images and documents, or run one-off prompts without leaving your shell.';

function wrapText(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function aboutSectionLineCount() {
  const width = terminalWidth({ min: 60, max: 100 });
  return wrapText(ABOUT_TEXT, width - 2).length + 4; // heading + body + blank separator + link
}

function printAboutSection() {
  const width = terminalWidth({ min: 60, max: 100 });
  const bar = c('│', 'steelBlue');
  console.log(bar + ' ' + c('This is QueckSilver CLI', 'steelBlue'));
  const bodyLines = wrapText(ABOUT_TEXT, width - 2);
  bodyLines.forEach((line) => console.log(`${bar} ${line}`));
  console.log(bar);
  console.log(`${bar} ${c('More details here: ', 'gray')}${c('https://quecksilver.ch/cli', 'blue')}`);
  console.log();
  return bodyLines.length + 4;
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

async function interactiveChat(token, { files = [], open, initialHistory = [], usedLines = 0, account = null } = {}) {
  let lines = usedLines;

  // Everything printed before the person's first real message (the welcome
  // panel/logo above, the "Type your message..." hint, the about blurb) is
  // static — it's drawn once and never touched again. A terminal zoom
  // changes column/row count exactly like a window resize does, but
  // nothing was redrawing this header on that event, so the terminal's own
  // reflow of that already-printed text corrupted the logo and clipped the
  // quick-tips column. `redrawHeader` reprints this whole block fresh at
  // the new size; it's wired up below and switched off the moment the
  // first real input arrives, since after that this text is genuine chat
  // history that shouldn't be wiped and replaced by a fresh header.
  let headerActive = true;
  const printIntro = () => {
    console.log(c('Type your message and press Enter to chat. Type "exit" to quit, or /commands to see everything else you can do.', 'gray'));
    console.log();
    let n = 2;
    const aboutCost = aboutSectionLineCount();
    if (process.stdout.isTTY && (process.stdout.rows || 24) - n - aboutCost - 4 > 0) {
      n += printAboutSection();
    }
    if (initialHistory.length > 0) {
      console.log(c(`Resumed previous session (${initialHistory.length / 2} turn(s)).`, 'gray'));
      console.log();
      n += 2;
    }
    return n;
  };
  const resizeCoordinator = { justRedrew: false };
  const redrawHeader = () => {
    if (!headerActive) return;
    lines = account ? printWelcomePanel(account) : 0;
    lines += printIntro();
    padToBottom(lines, { reserve: 4 });
    resizeCoordinator.justRedrew = true;
  };
  if (account) process.stdout.on('resize', redrawHeader);

  const STATUS_TEXT = 'QueckSilver CLI • Powered by Zora';
  const history = [...initialHistory];
  lines += printIntro();
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

  // Same terminalWidth() range the welcome panel above used for its own
  // `total`, so the input box lines up edge-to-edge with it instead of a
  // narrower default width leaving it looking cut short.
  const chatWidth = terminalWidth({ min: 80, max: 200 });

  // Draws the input as a real box — rule, typed text, rule, status line —
  // and resolves with whatever was typed. See readBoxedInput() in ui.js for
  // why this replaced the old readline-based prompt.
  const promptNext = () => readBoxedInput({ width: chatWidth, statusText: STATUS_TEXT, knownCommands: KNOWN_SLASH_COMMANDS, resizeCoordinator });

  // readBoxedInput always draws exactly 4 rows (rule, input, rule, status)
  // — reserve that many so the box's own bottom rule lands flush against
  // the terminal's last row instead of floating right after whatever was
  // printed above it.
  padToBottom(lines, { reserve: 4 });

  while (true) {
    const line = await promptNext();
    const text = line.trim();
    if (!text) continue;
    if (headerActive) {
      headerActive = false;
      process.stdout.removeListener('resize', redrawHeader);
    }
    if (text === 'exit' || text === 'quit') break;

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
      continue;
    }

    const outputCmd = text.match(/^\/output\s+(.+)$/i);
    if (outputCmd) {
      pendingOutput = stripQuotes(outputCmd[1]);
      console.log(c(`Your next reply will also be saved to ${pendingOutput}`, 'gray'));
      continue;
    }

    if (/^\/open$/i.test(text)) {
      sessionOpen = !sessionOpen;
      console.log(c(`Auto-open is now ${sessionOpen ? 'on' : 'off'} for this session.`, 'gray'));
      continue;
    }

    if (/^\/continue$/i.test(text)) {
      const previous = loadLastSession();
      if (previous.length === 0) {
        console.log(c('No previous session found.', 'gray'));
      } else {
        history.unshift(...previous);
        console.log(c(`Loaded ${previous.length / 2} previous turn(s) into this conversation.`, 'gray'));
      }
      continue;
    }

    const configCmd = text.match(/^\/config(?:\s+set\s+(\S+)\s+(\S+))?$/i);
    if (configCmd) {
      if (configCmd[1]) {
        setSetting(configCmd[1], parseSettingValue(configCmd[2]));
        console.log(c(`${configCmd[1]} = ${configCmd[2]}`, 'gray'));
      } else {
        printSettings(getAllSettings());
      }
      continue;
    }

    if (/^\/usage$/i.test(text)) {
      await printUsage(token);
      continue;
    }

    if (/^\/(?:commands|help)$/i.test(text)) {
      printCommandList();
      continue;
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
      continue;
    }

    try {
      const result = await askQuecksilverStream(text, history, token, pendingFiles, { prefix: c('zora> ', 'bold') });
      pendingFiles = [];
      console.log();
      finishTurn(text, result);
    } catch (err) {
      console.error(c(`Connection error: ${err.message}`, 'red'));
    }
  }

  console.log('\nSee you soon!');
  process.exit(0);
}

// Shared "start a session" step: shows the account panel, then drops into
// either a forced-tool call, a one-off answer, or the interactive chat loop.
async function startSession(token, options) {
  let usedLines = 0;
  let account = null;
  if (!options.json) {
    [account] = await Promise.all([
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
    await interactiveChat(token, { files, open: options.open, initialHistory: continuedHistory, usedLines, account });
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
    const redraw = () => {
      printWelcomeBanner();
      console.log(c('You are not logged in yet.', 'yellow'));
      console.log(`Run ${c('quecksilver login', 'steelBlue')} to sign in and get started.`);
      console.log();
    };
    redraw();
    // The program would otherwise exit the instant this prints, leaving
    // nothing running to catch a resize/zoom right after — this keeps it
    // alive just long enough to redraw cleanly if that happens.
    await waitBriefly({ onResize: redraw });
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
