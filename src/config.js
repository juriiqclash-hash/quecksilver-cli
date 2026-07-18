import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.quecksilver');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function saveToken(token) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2));
}

export function getToken() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    return data.token || null;
  } catch {
    return null;
  }
}

export function clearToken() {
  if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
}