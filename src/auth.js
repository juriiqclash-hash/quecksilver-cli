import http from 'http';
import { saveToken } from './config.js';
import { openPath } from './ui.js';

const PORT = 51234;
const APP_URL = 'https://quecksilver.ch';

// Runs the browser login flow and resolves with the access token once the
// user authorizes it on the /cli-auth confirmation page. Does NOT print a
// final message or exit — the caller (index.js's loginCommand) decides what
// happens after a successful login (e.g. "press any key to continue").
export function runLoginFlow() {
  return new Promise((resolve, reject) => {
    const loginUrl = `${APP_URL}/cli-auth?redirect=${encodeURIComponent(`http://localhost:${PORT}/callback`)}`;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get('token');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        token
          ? '<html><body style="font-family: sans-serif; padding: 40px; background: #ffffff;">Login successful! You can close this window and return to the terminal.</body></html>'
          : '<html><body style="font-family: sans-serif; padding: 40px; background: #ffffff;">Login failed: no token received.</body></html>'
      );

      // Wait for the response to actually be flushed before closing the
      // server / resolving — closing too early can show the browser a
      // "connection refused" page even though the login itself succeeded.
      res.on('finish', () => {
        server.close();
        setTimeout(() => {
          if (token) {
            saveToken(token);
            resolve(token);
          } else {
            reject(new Error('No token received'));
          }
        }, 150);
      });
    });

    server.listen(PORT, () => {
      console.log('Opening browser to log in...');
      openPath(loginUrl);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out (5 min). Try again.'));
    }, 5 * 60 * 1000);
  });
}