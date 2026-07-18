import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.quecksilver');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const SESSION_FILE = join(CONFIG_DIR, 'last-session.json');

const DEFAULT_SETTINGS = { autoOpen: false, checkUpdates: true };

function readConfigFile() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfigFile(data) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

export function saveToken(token) {
  const data = readConfigFile();
  data.token = token;
  writeConfigFile(data);
}

export function getToken() {
  return readConfigFile().token || null;
}

// Only clears the login token — settings (autoOpen, checkUpdates, ...) live
// in the same file and should survive a logout.
export function clearToken() {
  const data = readConfigFile();
  delete data.token;
  writeConfigFile(data);
}

export function getAllSettings() {
  const data = readConfigFile();
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

export function getSetting(key) {
  return getAllSettings()[key];
}

export function setSetting(key, value) {
  const data = readConfigFile();
  data.settings = { ...(data.settings || {}), [key]: value };
  writeConfigFile(data);
}

// Backs --continue/-c and /continue — a lightweight local record of the last
// conversation's history, separate from config.json since it's rewritten far
// more often and isn't something a user hand-edits.
export function saveLastSession(history) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(history));
  } catch {
    // Best-effort — a failed save just means --continue won't have this turn.
  }
}

export function loadLastSession() {
  if (!existsSync(SESSION_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
