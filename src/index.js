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
  c, mascot, logoArt, twoColumnBox, terminalWidth, clearScreen, setTerminalTitle,
  centerBlock, visibleLength, startThinkingSpinner, openPath, createChatDock,
  waitBriefly, wrapText, renderMarkdown, userMessageBlock, detectTerminalWidth,
} from './ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const SUPABASE_URL = 'https://pwdncixmwxedfhtiwpmt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cli-chat`;
const VERSION = pkg.version;

// Shared width bound for every full-terminal-width element (the splash
// logo, the welcome panel, the user-message bar) — 200 turned out to be an
// active cap on real wide monitors/small fonts (200+ columns is common),
// leaving a visible gap on the right that the left edge didn't have. 400
// is generous enough to just mean "the terminal's own width" in practice
// while still bounding the pathological case of a garbage-reported column
// count. Matches ui.js's own footerWidth() so the panel/message bar and
// the docked input box's rule/status line always line up.
const FULL_WIDTH = { min: 80, max: 400 };

// Marks the start of an assistant reply — a plain colored dot, not a
// "zora> " label, so the transcript reads like a normal chat log instead
// of a raw prompt echo. Wrapped continuation lines below it start flush
// left with no repeated marker, same as the single-marker convention used
// throughout the rest of this file's boxes and callouts.
const ASSISTANT_MARK = c('● ', 'steelBlue');

// A recoverable API failure (expired session, rate limit, non-2xx
// response) — thrown by the ask* functions below instead of them printing
// straight to the terminal and calling process.exit() themselves. That
// used to be safe when this was the only kind of terminal UI the CLI had,
// but interactiveChat's docked footer runs in the alternate screen buffer
// (see createChatDock() in ui.js): a message printed there and immediately
// followed by process.exit() is invisible — the exit handoff back to the
// primary screen happens before anyone could ever see it, so a session
// expiring mid-chat looked exactly like the CLI silently quitting for no
// reason. Throwing instead lets each call site decide *where* the message
// actually ends up: interactiveChat's own catch block routes it through
// the dock (visible) and, for the one truly un-retryable case — a session
// that's actually expired — leaves the alternate screen first so the
// final message lands on the terminal the person is looking at, exactly
// like the one-off (non-interactive) paths already did before any of this.
function apiError(message, { sessionExpired = false } = {}) {
  const err = new Error(message);
  err.sessionExpired = sessionExpired;
  return err;
}

// Renders a reply's Markdown into clean ANSI, as one block with the
// assistant marker folded into its first line — shared by printReply()
// below (the final, committed reply) and askQuecksilverStream's live
// preview (the same reply, re-rendered on every chunk while it's still
// streaming in), so what's on screen never visibly changes shape at the
// moment the preview is replaced by the real thing.
function formatReply(text, mark = '') {
  const width = terminalWidth({ min: 60, max: 100 });
  const lines = renderMarkdown(text, width).split('\n');
  lines[0] = mark + (lines[0] ?? '');
  return '\n' + lines.join('\n');
}

// `mark` defaults to '' for the scripting-adjacent one-off paths that
// never showed a speaker label, and `log` defaults to console.log for
// those same paths (interactiveChat passes its docked footer's print()
// instead).
function printReply(text, { mark = '', log = console.log } = {}) {
  log(formatReply(text, mark));
}

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
  setTerminalTitle('QueckSilver CLI');
  const width = terminalWidth(FULL_WIDTH);
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
// `clear` is skipped by interactiveChat, which prints this fresh into an
// already-blank alternate screen buffer; `log` lets it route through the
// docked footer's print() there too, instead of a plain console.log that
// would land outside the dock's own content-buffer bookkeeping.
function printWelcomePanel({ email, isPro }, { log = console.log, clear = true } = {}) {
  if (clear) { clearScreen(); setTerminalTitle('QueckSilver CLI'); }
  const plan = isPro ? 'Pro' : 'Free';
  const rawName = email.split('@')[0] || 'there';
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);

  const total = terminalWidth(FULL_WIDTH);
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
  log(output);
  log();
  return output.split('\n').length + 1; // +1 for the trailing blank line above
}

function parseSettingValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

// `log` defaults to plain console.log for the top-level (non-chat) call
// sites; interactiveChat passes its docked footer's print() instead, since
// a raw console.log while the chat's fixed-bottom scroll region is active
// would land in the footer rows instead of the scrolling conversation area.
function printSettings(settings, log = console.log) {
  log(c('Settings:', 'gray'));
  for (const [key, value] of Object.entries(settings)) {
    log(c(`  ${key} = ${value}`, 'gray'));
  }
}

async function printUsage(token, log = console.log) {
  const account = await fetchAccountInfo(token);
  const plan = account.isPro ? 'QueckSilver Pro' : 'QueckSilver Free';
  log(c(`Plan: ${plan}`, 'gray'));
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/check-usage`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (res.ok) {
      const data = await res.json();
      log(c(`Service status: ${data.sleeping ? 'temporarily limited (daily budget reached)' : 'normal'} (${data.percentUsed}% of today's shared budget used)`, 'gray'));
    } else {
      log(c(`(Service status unavailable: HTTP ${res.status})`, 'gray'));
    }
  } catch {
    // Best-effort — usage info just won't show if this fails.
  }
  log(c('CLI rate limits: 10 chat requests / min, 20 generations (image/document/music) / 15 min.', 'gray'));
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

function printSources(sources, log = console.log) {
  if (!sources || sources.length === 0) return;
  log(c('Sources:', 'gray'));
  sources.forEach((s, i) => log(c(`  [${i + 1}] ${s.title} — ${s.url}`, 'gray')));
}

function printSavedPaths(paths, log = console.log) {
  paths.forEach((p) => log(c(`Saved: ${p}`, 'gray')));
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
export function printCommandList(log = console.log) {
  const colWidth = Math.max(...COMMAND_SECTIONS.flatMap((s) => s.rows.map(([cmd]) => cmd.length))) + 2;
  COMMAND_SECTIONS.forEach((section, i) => {
    if (i > 0) log();
    log(c(section.heading, 'gray'));
    section.rows.forEach(([cmd, desc]) => {
      log(`  ${c(cmd.padEnd(colWidth), 'blue')}${c(desc, 'gray')}`);
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
// Returns how many terminal lines it used, so the caller can decide
// whether there's enough room to show it at all on a short terminal.
const ABOUT_TEXT = 'QueckSilver CLI brings QueckSilver AI (Zora) into your terminal: chat, '
  + 'attach files, generate images and documents, or run one-off prompts without leaving your shell.';

function aboutSectionLineCount() {
  const width = terminalWidth({ min: 60, max: 100 });
  return wrapText(ABOUT_TEXT, width - 2).length + 4; // heading + body + blank separator + link
}

function printAboutSection(log = console.log) {
  const width = terminalWidth({ min: 60, max: 100 });
  const bar = c('│', 'steelBlue');
  log(bar + ' ' + c('This is QueckSilver CLI', 'steelBlue'));
  const bodyLines = wrapText(ABOUT_TEXT, width - 2);
  bodyLines.forEach((line) => log(`${bar} ${line}`));
  log(bar);
  log(`${bar} ${c('More details here: ', 'gray')}${c('https://quecksilver.ch/cli', 'blue')}`);
  log();
  return bodyLines.length + 4;
}

// Directly invokes one tool server-side (bypasses Zora's own tool choice) —
// backs the /search, /image, /doc and /music slash commands (and their
// --search/--image/--doc/--music startup-flag equivalents). `files` carries
// any pending attachments — e.g. an image to use as a create_image edit
// reference.
async function askForcedTool(forceTool, token, files = [], { spinner: spinnerFactory = startThinkingSpinner } = {}) {
  const spinner = spinnerFactory();

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
    throw apiError('Session expired. Run "quecksilver login" to sign in again.', { sessionExpired: true });
  }

  if (response.status === 429) {
    spinner.stop();
    throw apiError('Too many requests. Wait a bit and try again.');
  }

  if (!response.ok) {
    spinner.stop();
    const errBody = await response.json().catch(() => ({}));
    throw apiError(`Error: ${response.status} ${errBody.error || response.statusText}`);
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
    throw apiError('Session expired. Run "quecksilver login" to sign in again.', { sessionExpired: true });
  }

  if (response.status === 429) {
    spinner?.stop();
    throw apiError('Too many requests. Wait a bit and try again.');
  }

  if (!response.ok) {
    spinner?.stop();
    const errBody = await response.json().catch(() => ({}));
    throw apiError(`Error: ${response.status} ${errBody.error || response.statusText}`);
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
async function askQuecksilverStream(prompt, history, token, files = [], { prefix = '', log = console.log, spinner: spinnerFactory = startThinkingSpinner, setEphemeral = null } = {}) {
  const spinner = spinnerFactory();
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
    throw apiError('Session expired. Run "quecksilver login" to sign in again.', { sessionExpired: true });
  }

  if (response.status === 429) {
    spinner.stop();
    throw apiError('Too many requests. Wait a bit and try again.');
  }

  if (!response.ok) {
    spinner.stop();
    const errBody = await response.json().catch(() => ({}));
    throw apiError(`Error: ${response.status} ${errBody.error || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullReply = '';
  let spinnerStopped = false;
  let final = null;

  const stopSpinner = () => {
    if (!spinnerStopped) { spinner.stop(); spinnerStopped = true; }
  };

  // Text arrives token-by-token as Markdown source (**bold**, "- " bullets,
  // headings, ...) — echoing each raw chunk the instant it lands would
  // just show the punctuation unrendered. But waiting for the *entire*
  // reply before showing anything reads as a stall (no feedback at all
  // until the whole thing is done), especially next to the web app's own
  // live-typing reply. setEphemeral splits the difference: every chunk
  // re-renders the *whole* reply so far through the same formatter as the
  // final version and re-stages it as the dock's live preview — so it's
  // visibly typing in, already close to its final look the whole time
  // (an unclosed "**bold" just reads as plain text until its closing "**"
  // arrives), and the moment the stream ends this exact rendering gets
  // committed for real, with no visible change in shape.
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
        log(c(`Error: ${evt.error}`, 'red'));
      } else if (evt.text) {
        stopSpinner();
        fullReply += evt.text;
        if (setEphemeral) setEphemeral(formatReply(fullReply, prefix));
      } else if (evt.done) {
        final = evt;
      }
    }
  }

  stopSpinner();
  if (fullReply) printReply(fullReply, { mark: prefix, log });

  const elapsed = Math.max(1, Math.round((Date.now() - start) / 1000));
  const tokenPart = final?.usage?.totalTokens ? ` · ${final.usage.totalTokens} tokens` : '';
  log(c(`✓ thought for ${elapsed}s${tokenPart}`, 'dim'));

  return {
    reply: fullReply || '(no reply received)',
    attachments: final?.attachments || [],
    sources: final?.sources || [],
    usage: final?.usage || null,
  };
}

async function oneOff(prompt, token, { files = [], output, json, open, history = [] } = {}) {
  let result;
  try {
    result = json
      ? await askQuecksilver(prompt, history, token, files, { quiet: true })
      : await askQuecksilverStream(prompt, history, token, files);
  } catch (err) {
    console.log(c(err.message, 'red'));
    process.exit(1);
  }

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
  let result;
  try {
    result = await askForcedTool(forceTool, token, files);
  } catch (err) {
    console.log(c(err.message, 'red'));
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result));
  } else {
    printReply(result.reply);
    printSources(result.sources);
  }

  const saved = saveAttachments(result.attachments, { open });
  if (!json) printSavedPaths(saved);

  if (output) {
    writeFileSync(output, result.reply, 'utf-8');
    if (!json) console.log(c(`Saved reply to ${output}`, 'gray'));
  }
}

async function interactiveChat(token, { files = [], open, initialHistory = [], account = null } = {}) {
  const dock = createChatDock();
  const out = (s = '') => dock.print(s);

  // The dock switches to the alternate screen buffer here, before anything
  // else is printed — see createChatDock()'s own comment for why: a real
  // terminal has exactly one scrollback, so a footer "pinned" against it
  // gets dragged along the instant the person scrolls; the alt screen has
  // no native scrollback for it to get dragged through in the first place.
  // Content and the footer are engaged empty, then the welcome panel/intro
  // print through the dock itself (via `out`, not a plain console.log)
  // so they become part of its own scrollable content buffer.
  dock.start();
  // Some terminals (ConPTY-backed ones — Windows Terminal/PowerShell among
  // them — in particular) haven't finished settling their own reported
  // column count by the moment the alternate-screen switch write above
  // actually lands, so a size read on the very next tick can come back
  // narrower than the window's real, current width — seen as the panel
  // and the footer's rule both stopping short of the right edge while the
  // left edge sits flush. A brief pause before the first geometry read
  // (engage(), which sizes the footer) and the first render gives it a
  // moment to catch up; imperceptible at human reaction time either way.
  if (process.stdout.isTTY) await new Promise((resolve) => setTimeout(resolve, 50));
  const STATUS_TEXT = 'QueckSilver CLI • Powered by Zora';
  dock.engage({ statusText: STATUS_TEXT, knownCommands: KNOWN_SLASH_COMMANDS });

  // A crash anywhere that isn't already wrapped in a try/catch on the
  // turn-processing path above (a timer callback like the spinner's tick,
  // a bug in a redraw) would otherwise be a genuinely silent exit: Node's
  // default handling for an uncaught exception prints to stderr and quits
  // *before* the dock's own exit-time cleanup gets a real chance to run
  // first, so the message (if it's even visible at all, mid alt-screen)
  // is gone the instant the screen switches back. This guarantees the
  // alternate screen is actually left — so whatever went wrong is visible
  // on the terminal the person is looking at — before reporting it.
  process.on('uncaughtException', (err) => {
    dock.stop();
    console.error(c(`Unexpected error: ${err.message}`, 'red'));
    process.exit(1);
  });

  if (account) printWelcomePanel(account, { log: out, clear: false });
  // The panel above this point is permanent — it's never cleared or
  // redrawn again, it just scrolls off naturally as the conversation
  // grows, same as any other line of chat history. Only the short "Type
  // your message..."/"This is QueckSilver CLI" blurb printed right after
  // it is meant to go away once real chatting starts; `introMark` is the
  // content buffer's length right before that blurb, so dock.truncateTo()
  // below can cut just it back out without touching the panel above it.
  const introMark = dock.mark();
  let headerActive = true;
  const printIntro = () => {
    out(c('Type your message and press Enter to chat. Type "exit" to quit, or /commands to see everything else you can do.', 'gray'));
    out();
    const aboutCost = aboutSectionLineCount();
    if (process.stdout.isTTY && (process.stdout.rows || 24) - aboutCost - 6 > 0) {
      printAboutSection(out);
    }
    if (initialHistory.length > 0) {
      out(c(`Resumed previous session (${initialHistory.length / 2} turn(s)).`, 'gray'));
      out();
    }
  };

  const history = [...initialHistory];
  printIntro();
  let pendingFiles = files;
  let pendingOutput = null;
  let sessionOpen = open ?? getSetting('autoOpen');

  const stripQuotes = (s) => s.trim().replace(/^"(.*)"$/, '$1');

  // Shared tail for both the forced-tool and normal chat paths: print
  // sources/saved attachments, honor a queued /output path, record the turn
  // in history so follow-up questions can reference it, and persist the
  // growing history so --continue/-c can pick it up later.
  const finishTurn = (text, result) => {
    printSources(result.sources, out);
    printSavedPaths(saveAttachments(result.attachments, { open: sessionOpen }), out);
    if (pendingOutput) {
      writeFileSync(pendingOutput, result.reply, 'utf-8');
      out(c(`Saved reply to ${pendingOutput}`, 'gray'));
      pendingOutput = null;
    }
    history.push({ role: 'user', text });
    history.push({ role: 'model', text: result.reply });
    saveLastSession(history);
  };

  // A failed turn (network error, rate limit, expired session — see
  // apiError()'s own comment for why these are thrown rather than printed
  // straight from inside the ask* functions) always gets shown in the
  // chat itself first, so it's visible right where the person is already
  // looking. A session that's actually expired can't recover by itself —
  // every further message would fail identically — so that one case also
  // ends the session outright, but only *after* leaving the alternate
  // screen, so the final message lands on the terminal the person
  // actually sees once control returns to their shell, not on the
  // about-to-be-abandoned alt-screen buffer. Returns true when the caller
  // should stop the turn loop (the session already ended).
  const handleTurnError = (err) => {
    out(c(`Connection error: ${err.message}`, 'red'));
    if (!err.sessionExpired) return false;
    dock.stop();
    console.log(c(err.message, 'red'));
    process.exit(1);
    return true;
  };

  // Same terminalWidth() range the welcome panel above used for its own
  // `total`, so the user-message bar lines up edge-to-edge with it instead
  // of a narrower default width leaving it looking cut short.
  const chatWidth = terminalWidth(FULL_WIDTH);

  while (true) {
    const line = await dock.nextMessage();
    const text = line.trim();
    if (!text) continue;
    if (headerActive) {
      // Only the "type your message"/"This is QueckSilver CLI" blurb goes
      // away here — the welcome panel above `introMark` is untouched, and
      // the fixed input box itself lives outside the content buffer
      // entirely, so it never disappears or flickers even for this first turn.
      headerActive = false;
      dock.truncateTo(introMark);
    }
    out(userMessageBlock(text, chatWidth));
    out();
    if (text === 'exit' || text === 'quit') break;

    const fileCmd = text.match(/^\/(?:file|attach)\s+(.+)$/i);
    if (fileCmd) {
      const rawPath = stripQuotes(fileCmd[1]);
      try {
        const [attached] = readAttachments([rawPath]);
        pendingFiles = [...pendingFiles, attached];
        out(c(`Attached: ${attached.name} (will be sent with your next message)`, 'gray'));
      } catch (err) {
        out(c(err.message, 'red'));
      }
      continue;
    }

    const outputCmd = text.match(/^\/output\s+(.+)$/i);
    if (outputCmd) {
      pendingOutput = stripQuotes(outputCmd[1]);
      out(c(`Your next reply will also be saved to ${pendingOutput}`, 'gray'));
      continue;
    }

    if (/^\/open$/i.test(text)) {
      sessionOpen = !sessionOpen;
      out(c(`Auto-open is now ${sessionOpen ? 'on' : 'off'} for this session.`, 'gray'));
      continue;
    }

    if (/^\/continue$/i.test(text)) {
      const previous = loadLastSession();
      if (previous.length === 0) {
        out(c('No previous session found.', 'gray'));
      } else {
        history.unshift(...previous);
        out(c(`Loaded ${previous.length / 2} previous turn(s) into this conversation.`, 'gray'));
      }
      continue;
    }

    const configCmd = text.match(/^\/config(?:\s+set\s+(\S+)\s+(\S+))?$/i);
    if (configCmd) {
      if (configCmd[1]) {
        setSetting(configCmd[1], parseSettingValue(configCmd[2]));
        out(c(`${configCmd[1]} = ${configCmd[2]}`, 'gray'));
      } else {
        printSettings(getAllSettings(), out);
      }
      continue;
    }

    if (/^\/usage$/i.test(text)) {
      await printUsage(token, out);
      continue;
    }

    if (/^\/(?:commands|help)$/i.test(text)) {
      printCommandList(out);
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
        const result = await askForcedTool(forceTool, token, pendingFiles, { spinner: dock.spinner });
        pendingFiles = [];
        printReply(result.reply, { mark: ASSISTANT_MARK, log: out });
        out();
        finishTurn(text, result);
      } catch (err) {
        if (handleTurnError(err)) return;
      }
      continue;
    }

    try {
      const result = await askQuecksilverStream(text, history, token, pendingFiles, { prefix: ASSISTANT_MARK, log: out, spinner: dock.spinner, setEphemeral: dock.setEphemeral });
      pendingFiles = [];
      out();
      finishTurn(text, result);
    } catch (err) {
      if (handleTurnError(err)) return;
    }
  }

  // Printed after leaving the alternate screen, not into it — anything
  // written there right before stop() would vanish the instant the switch
  // back to the normal screen happens, along with the rest of the buffer.
  dock.stop();
  console.log('\nSee you soon!');
  process.exit(0);
}

// Shared "start a session" step: shows the account panel, then drops into
// either a forced-tool call, a one-off answer, or the interactive chat loop.
//
// The welcome panel is only printed here (on the normal screen) for the
// one-shot paths (forced-tool / one-off prompt) — interactiveChat switches
// to the alternate screen buffer for its fixed-bottom input dock, which
// starts out blank, so it prints its own copy of the panel fresh into that
// buffer instead of inheriting one drawn on a screen it's about to leave.
async function startSession(token, options) {
  let account = null;
  if (!options.json) {
    [account] = await Promise.all([
      fetchAccountInfo(token),
      getSetting('checkUpdates') ? checkForUpdate() : Promise.resolve(),
    ]);
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
    if (account) printWelcomePanel(account);
    await oneOffForcedTool(options.forceTool, token, { files, output: options.output, json: options.json, open: options.open });
    return;
  }

  const continuedHistory = options.continueSession ? loadLastSession() : [];

  let prompt = (options.promptArgs || []).join(' ').trim();
  if (!prompt && files.length > 0) {
    prompt = 'Please analyze the attached content.';
  }

  if (prompt) {
    if (account) printWelcomePanel(account);
    if (options.continueSession && !options.json) {
      console.log(c(
        continuedHistory.length > 0
          ? `Resumed previous session (${continuedHistory.length / 2} turn(s)).`
          : 'No previous session found — starting fresh.',
        'gray',
      ));
      console.log();
    }
    await oneOff(prompt, token, {
      files, output: options.output, json: options.json, open: options.open, history: continuedHistory,
    });
  } else {
    await interactiveChat(token, { files, open: options.open, initialHistory: continuedHistory, account });
  }
}

// `quecksilver` with no subcommand: shows the banner, and either starts
// chatting (already logged in) or tells the user to run `quecksilver login`.
export async function main(options) {
  // Best-effort: on some setups process.stdout.columns itself under-reports
  // the terminal's real width (confirmed independent of anything this CLI
  // draws — see detectTerminalWidth()'s own comment in ui.js), which no
  // amount of clamping/margin math on our end can correct since it isn't
  // a rendering bug, it's wrong input. Asking the terminal directly, once,
  // before anything width-dependent prints, is what actually fixes that;
  // costs nothing beyond a short timeout on terminals that just don't
  // support the query, where it silently falls through to the old behavior.
  if (!options.json) await detectTerminalWidth();

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
