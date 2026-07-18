import readline from 'readline';
import { getToken } from './config.js';

const SUPABASE_URL = 'https://pwdncixmwxedfhtiwpmt.supabase.co';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cli-chat`;

async function askQuecksilver(prompt, history, token) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, history }),
  });

  if (response.status === 401) {
    console.log('Not logged in, or your login expired. Run "quecksilver login" first.');
    process.exit(1);
  }

  if (response.status === 429) {
    console.log('Too many requests. Wait a bit and try again.');
    process.exit(1);
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error('Error:', response.status, errBody.error || response.statusText);
    process.exit(1);
  }

  const data = await response.json();
  return data.reply || '(no reply received)';
}

async function oneOff(prompt, token) {
  console.log('Thinking...');
  const reply = await askQuecksilver(prompt, [], token);
  console.log('\n' + reply);
}

async function interactiveChat(token) {
  console.log('QueckSilver CLI — type your message, or "exit" to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  const history = [];

  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    if (text === 'exit' || text === 'quit') { rl.close(); return; }

    try {
      const reply = await askQuecksilver(text, history, token);
      console.log('\nquecksilver> ' + reply + '\n');
      history.push({ role: 'user', text });
      history.push({ role: 'model', text: reply });
    } catch (err) {
      console.error('Connection error:', err.message);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nSee you soon!');
    process.exit(0);
  });
}

export async function main(args) {
  const token = getToken();
  if (!token) {
    console.log('You are not logged in yet. Run:\n');
    console.log('  quecksilver login\n');
    return;
  }

  const prompt = args.join(' ').trim();

  if (prompt) {
    await oneOff(prompt, token);
  } else {
    await interactiveChat(token);
  }
}