import readline from 'readline';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname, basename } from 'path';
import { homedir } from 'os';
import { getToken } from './config.js';
import { runLoginFlow } from './auth.js';
import { c, box, mascot, centerBlock, startThinkingSpinner } from './ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const SUPABASE_URL = 'https://pwdncixmwxedfhtiwpmt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cli-chat`;
const VERSION = pkg.version;
const BANNER_WIDTH = 46;

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

function printWelcomeBanner() {
  console.log();
  console.log(centerBlock(c('Welcome to QueckSilver AI', 'steelBlue'), BANNER_WIDTH));
  console.log(centerBlock(c(`v${VERSION}`, 'gray'), BANNER_WIDTH));
  console.log();
  console.log(centerBlock(mascot(), BANNER_WIDTH));
  console.log();
}

function printAccountPanel({ email, isPro }) {
  const plan = isPro ? 'QueckSilver Pro' : 'QueckSilver Free';
  console.log(
    box(
      [c('Zora 6.1', 'bold') + c('  ·  ', 'gray') + c(plan, 'steelBlue'), c(email, 'gray')],
      { color: 'steelBlue', minWidth: BANNER_WIDTH - 4 }
    )
  );
  console.log();
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

// Saves image/document attachments from a cli-chat response to
// ~/quecksilver/{images,documents}/ and returns the saved paths.
function saveAttachments(attachments) {
  const saved = [];
  for (const att of attachments || []) {
    if (att.kind === 'image') {
      const dir = join(homedir(), 'quecksilver', 'images');
      mkdirSync(dir, { recursive: true });
      const ext = EXT_BY_IMAGE_MIME[att.mimeType] || '.png';
      const filePath = join(dir, `image-${Date.now()}${ext}`);
      writeFileSync(filePath, Buffer.from(att.base64, 'base64'));
      saved.push(filePath);
    } else if (att.kind === 'document') {
      const dir = join(homedir(), 'quecksilver', 'documents');
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, att.filename || `document-${Date.now()}`);
      writeFileSync(filePath, Buffer.from(att.base64, 'base64'));
      saved.push(filePath);
    }
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

// Directly invokes one tool server-side (bypasses Zora's own tool choice) —
// backs the /search, /image and /doc slash commands.
async function askForcedTool(forceTool, token) {
  const spinner = startThinkingSpinner();

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ forceTool }),
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

async function oneOff(prompt, token, { files = [], output, json } = {}) {
  const result = json
    ? await askQuecksilver(prompt, [], token, files, { quiet: true })
    : await askQuecksilverStream(prompt, [], token, files);

  if (json) {
    console.log(JSON.stringify(result));
  } else {
    printSources(result.sources);
  }

  const saved = saveAttachments(result.attachments);
  if (!json) printSavedPaths(saved);

  if (output) {
    writeFileSync(output, result.reply, 'utf-8');
    if (!json) console.log(c(`Saved reply to ${output}`, 'gray'));
  }
}

async function interactiveChat(token, { files = [] } = {}) {
  console.log(c('Type your message and press Enter to chat. Type "exit" to quit.', 'gray'));
  console.log(c('Slash commands: /file <path>, /search <query>, /image <prompt>,', 'gray'));
  console.log(c('/doc <docx|xlsx|pptx|pdf|markdown|csv> <topic>, /output <path>', 'gray'));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c('you> ', 'steelBlue'),
  });
  const history = [];
  let pendingFiles = files;
  let pendingOutput = null;

  const stripQuotes = (s) => s.trim().replace(/^"(.*)"$/, '$1');

  // Shared tail for both the forced-tool and normal chat paths: print
  // sources/saved attachments, honor a queued /output path, and record the
  // turn in history so follow-up questions can reference it.
  const finishTurn = (text, result) => {
    printSources(result.sources);
    printSavedPaths(saveAttachments(result.attachments));
    if (pendingOutput) {
      writeFileSync(pendingOutput, result.reply, 'utf-8');
      console.log(c(`Saved reply to ${pendingOutput}`, 'gray'));
      pendingOutput = null;
    }
    history.push({ role: 'user', text });
    history.push({ role: 'model', text: result.reply });
  };

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
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
      rl.prompt();
      return;
    }

    const outputCmd = text.match(/^\/output\s+(.+)$/i);
    if (outputCmd) {
      pendingOutput = stripQuotes(outputCmd[1]);
      console.log(c(`Your next reply will also be saved to ${pendingOutput}`, 'gray'));
      rl.prompt();
      return;
    }

    const searchCmd = text.match(/^\/search\s+(.+)$/i);
    const imageCmd = text.match(/^\/image\s+(.+)$/i);
    const docCmd = text.match(/^\/doc\s+(docx|xlsx|pptx|pdf|markdown|csv)\s+(.+)$/i);

    if (searchCmd || imageCmd || docCmd) {
      const forceTool = searchCmd
        ? { name: 'web_search', args: { query: searchCmd[1] } }
        : imageCmd
          ? { name: 'create_image', args: { prompt: imageCmd[1] } }
          : { name: 'create_document', args: { doc_type: docCmd[1].toLowerCase(), topic: docCmd[2] } };

      try {
        const result = await askForcedTool(forceTool, token);
        console.log('\n' + c('zora> ', 'bold') + result.reply + '\n');
        finishTurn(text, result);
      } catch (err) {
        console.error(c(`Connection error: ${err.message}`, 'red'));
      }
      rl.prompt();
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

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nSee you soon!');
    process.exit(0);
  });
}

// Shared "start a session" step: shows the account panel, then drops into
// either a one-off answer or the interactive chat loop.
async function startSession(token, options) {
  if (!options.json) {
    const account = await fetchAccountInfo(token);
    printAccountPanel(account);
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

  let prompt = (options.promptArgs || []).join(' ').trim();
  if (!prompt && files.length > 0) {
    prompt = 'Please analyze the attached content.';
  }

  if (prompt) {
    await oneOff(prompt, token, { files, output: options.output, json: options.json });
  } else {
    await interactiveChat(token, { files });
  }
}

// `quecksilver` with no subcommand: shows the banner, and either starts
// chatting (already logged in) or tells the user to run `quecksilver login`.
export async function main(options) {
  if (!options.json) printWelcomeBanner();

  const token = getToken();

  if (!token) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'Not logged in. Run "quecksilver login".' }));
      process.exit(1);
    }
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
