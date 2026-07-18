import readline from 'readline';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getToken } from './config.js';
import { runLoginFlow } from './auth.js';
import { c, box, mascot, centerBlock, startThinkingSpinner, waitForKeypress } from './ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const SUPABASE_URL = 'https://pwdncixmwxedfhtiwpmt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3ZG5jaXhtd3hlZGZodGl3cG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjE1NTIsImV4cCI6MjA5MDgzNzU1Mn0.z4qrH2YuBkVv9CbAOFNdbXD0wwAF8y-zCR584un_y9o';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cli-chat`;
const VERSION = pkg.version;
const BANNER_WIDTH = 46;

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

async function askQuecksilver(prompt, history, token) {
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
      body: JSON.stringify({ prompt, history }),
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
  const elapsed = Math.max(1, Math.round((Date.now() - start) / 1000));
  const tokenPart = data.usage?.totalTokens ? ` · ${data.usage.totalTokens} tokens` : '';
  spinner.stop(c(`✓ thought for ${elapsed}s${tokenPart}`, 'dim'));

  return data.reply || '(no reply received)';
}

async function oneOff(prompt, token) {
  const reply = await askQuecksilver(prompt, [], token);
  console.log('\n' + reply);
}

async function interactiveChat(token) {
  console.log(c('Type your message and press Enter to chat. Type "exit" to quit.', 'gray'));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c('you> ', 'steelBlue'),
  });
  const history = [];

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (text === 'exit' || text === 'quit') { rl.close(); return; }

    try {
      const reply = await askQuecksilver(text, history, token);
      console.log('\n' + c('zora> ', 'bold') + reply + '\n');
      history.push({ role: 'user', text });
      history.push({ role: 'model', text: reply });
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
async function startSession(token, args) {
  const account = await fetchAccountInfo(token);
  printAccountPanel(account);

  const prompt = args.join(' ').trim();
  if (prompt) {
    await oneOff(prompt, token);
  } else {
    await interactiveChat(token);
  }
}

// `quecksilver` with no subcommand: shows the banner, and either starts
// chatting (already logged in) or tells the user to run `quecksilver login`.
export async function main(args) {
  printWelcomeBanner();

  const token = getToken();

  if (!token) {
    console.log(c('You are not logged in yet.', 'yellow'));
    console.log(`Run ${c('quecksilver login', 'steelBlue')} to sign in and get started.`);
    console.log();
    return;
  }

  await startSession(token, args);
}

// `quecksilver login`: runs the browser auth flow, waits for the user to
// press a key on the green "Login successful" line, then goes straight
// into the welcome banner + account panel + chat — no second command needed.
export async function loginCommand() {
  let token;
  try {
    token = await runLoginFlow();
  } catch (err) {
    console.log(c(`Login failed: ${err.message}`, 'red'));
    process.exit(1);
  }

  console.log(c('Login successful.', 'green') + c(' Press any key to continue…', 'gray'));
  await waitForKeypress();

  printWelcomeBanner();
  await startSession(token, []);
}