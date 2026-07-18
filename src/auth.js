import http from 'http';
import { exec } from 'child_process';
import { saveToken } from './config.js';

const PORT = 51234;
// TODO: replace with your real production domain once deployed.
const APP_URL = 'https://quecksilver.ch';
const LOGIN_URL = `${APP_URL}/cli-auth?redirect=${encodeURIComponent(`http://localhost:${PORT}/callback`)}`;

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === 'win32' ? `start "" "${url}"` :
    platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log('Could not open the browser automatically. Open this link manually:');
      console.log(url);
    }
  });
}

export function login() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    const token = url.searchParams.get('token');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (token) {
      saveToken(token);
      res.end('<html><body style="font-family: sans-serif; padding: 40px;">Login successful! You can close this window and return to the terminal.</body></html>');
      console.log('Logged in! Run "quecksilver" to chat, or "quecksilver \\"your question\\"" for a single answer.');
    } else {
      res.end('<html><body style="font-family: sans-serif; padding: 40px;">Login failed: no token received.</body></html>');
      console.log('Login failed: no token received.');
    }

    server.close();
    process.exit(token ? 0 : 1);
  });

  server.listen(PORT, () => {
    console.log('Opening browser to log in...');
    openBrowser(LOGIN_URL);
  });

  // Safety timeout so the CLI doesn't hang forever if the browser flow stalls.
  setTimeout(() => {
    console.log('Login timed out (5 min). Try again with "quecksilver login".');
    server.close();
    process.exit(1);
  }, 5 * 60 * 1000);
}