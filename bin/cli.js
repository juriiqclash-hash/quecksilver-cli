#!/usr/bin/env node
import { main } from '../src/index.js';
import { login } from '../src/auth.js';

const args = process.argv.slice(2);

if (args[0] === 'login') {
  login();
} else if (args[0] === 'logout') {
  const { clearToken } = await import('../src/config.js');
  clearToken();
  console.log('Logged out.');
} else {
  main(args);
}