// Minimal terminal UI helpers: ANSI colors, box-drawing, and the QueckSilver
// pixel mascot — deliberately dependency-free (no chalk/boxen) so publishing
// stays simple.

import { execFile } from 'child_process';
import readline from 'readline';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

export const colors = {
  reset: RESET,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  gray: `${ESC}90m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  magenta: `${ESC}35m`,
  white: `${ESC}97m`,
  blue: `${ESC}34m`,
  // QueckSilver brand steel-blue, pulled directly from --primary in
  // src/index.css (dark theme, default accent): hsl(195 45% 55%) → rgb(89,166,192).
  steelBlue: `${ESC}38;2;89;166;192m`,
  // --zora-eye: hsl(216 8% 12%) → rgb(28,30,33), the mascot's eye color.
  eyeDark: `${ESC}38;2;28;30;33m`,
};

export function c(text, color) {
  return `${colors[color] ?? ''}${text}${RESET}`;
}

// Strips ANSI codes to measure real visible width (so box borders line up
// even when a line contains colored text).
export function visibleLength(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// Renders a bordered box around the given lines. With `title`, the top
// border reads "┌─ title ────┐" instead of a plain rule.
export function box(lines, { color = 'steelBlue', padding = 1, minWidth = 30, title } = {}) {
  const contentWidth = Math.max(minWidth, ...lines.map(visibleLength), title ? visibleLength(title) + 2 : 0);
  const innerWidth = contentWidth + padding * 2;
  const pad = ' '.repeat(padding);

  let top;
  if (title) {
    const label = ` ${title} `;
    const trailing = Math.max(1, innerWidth - 1 - visibleLength(label));
    top = c('┌─', color) + c(label, color) + c('─'.repeat(trailing), color) + c('┐', color);
  } else {
    top = c('┌' + '─'.repeat(innerWidth) + '┐', color);
  }
  const bottom = c('└' + '─'.repeat(innerWidth) + '┘', color);

  const body = lines.map((line) => {
    const visLen = visibleLength(line);
    const rightPad = ' '.repeat(Math.max(0, contentWidth - visLen));
    return c('│', color) + pad + line + rightPad + pad + c('│', color);
  });

  return [top, ...body, bottom].join('\n');
}

// Places two multi-line blocks side by side with a gap between them —
// used to lay the welcome panel's stats box and the mountain motif out as
// two columns, like Claude Code's own startup screen.
export function sideBySide(leftBlock, rightBlock, gap = 2) {
  const leftLines = leftBlock.split('\n');
  const rightLines = rightBlock.split('\n');
  const leftWidth = Math.max(...leftLines.map(visibleLength));
  const height = Math.max(leftLines.length, rightLines.length);
  const gapStr = ' '.repeat(gap);

  const rows = [];
  for (let i = 0; i < height; i++) {
    const left = leftLines[i] ?? '';
    const right = rightLines[i] ?? '';
    rows.push(left + ' '.repeat(Math.max(0, leftWidth - visibleLength(left))) + gapStr + right);
  }
  return rows.join('\n');
}

// A full-width horizontal rule, framing the chat input like a text box —
// printed right above the readline prompt on every turn.
export function divider(width) {
  const w = width || process.stdout.columns || 60;
  return c('─'.repeat(Math.max(10, w)), 'dim');
}

export function centerLine(text, width) {
  const len = visibleLength(text);
  if (len >= width) return text;
  const leftPad = Math.floor((width - len) / 2);
  return ' '.repeat(leftPad) + text;
}

// The QueckSilver / Zora pixel mascot — same 11x9 grid used by
// src/components/PixelMascot.tsx in the main app (shared mark across
// Council + Code workspace), reproduced here as colored terminal blocks.
// 0 = empty, 1 = body, 2 = eye
const MASCOT_GRID = [
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
  [0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
];

export function mascot({ bodyColor = 'steelBlue', eyeColor = 'eyeDark' } = {}) {
  return MASCOT_GRID.map((row) =>
    row
      .map((cell) => {
        if (cell === 0) return '  ';
        if (cell === 2) return c('██', eyeColor);
        return c('██', bodyColor);
      })
      .join('')
  ).join('\n');
}

// A mountain-landscape backdrop for the mascot — two snow-capped peaks over
// a scattering of stars, framed top and bottom by a dotted horizon line,
// with the Zora mascot standing in front at the left. Rows come back
// pre-colored and padded to `width` visible columns, so the block can be
// dropped straight into a centered banner or the right-hand column of the
// logged-in welcome panel.
export function mountainScene(width = 44) {
  const w = Math.max(26, width);
  const skyRows = 5;
  const mascotRows = MASCOT_GRID.length;
  const grid = Array.from({ length: skyRows + mascotRows }, () => Array(w).fill(' '));
  const paint = Array.from({ length: skyRows + mascotRows }, () => Array(w).fill(null));

  const stamp = (row, startCol, text, color) => {
    for (let i = 0; i < text.length; i++) {
      const col = startCol + i;
      if (col < 0 || col >= w) continue;
      grid[row][col] = text[i];
      paint[row][col] = color;
    }
  };
  const centered = (center, width2) => Math.round(center - width2 / 2);

  // Two peaks, tapering from a light "snow cap" at the apex down to a dark
  // base, merging into one ridge by the last mountain row.
  const peakCenters = [Math.round(w * 0.26), Math.round(w * 0.68)];
  peakCenters.forEach((cx) => stamp(0, centered(cx, 3), '░░░', 'gray'));
  peakCenters.forEach((cx) => stamp(1, centered(cx, 7), '▓▓▓▓▓▓▓', 'gray'));
  peakCenters.forEach((cx) => stamp(2, centered(cx, 13), '▓▓▓▓▓▓▓▓▓▓▓▓▓', 'gray'));
  const baseWidth = Math.min(w - 4, 40);
  stamp(3, centered(w / 2, baseWidth), '▓'.repeat(baseWidth), 'gray');
  stamp(4, centered(w / 2, Math.max(0, baseWidth - 6)), '░'.repeat(Math.max(0, baseWidth - 6)), 'dim');

  // Scattered stars, skipping any cell a mountain already claimed.
  const starSpots = [[0, 2], [0, w - 4], [1, w - 6], [2, 2], [5, w - 5], [7, w - 8]];
  starSpots.forEach(([row, col]) => {
    if (row < grid.length && col >= 0 && col < w && grid[row][col] === ' ') {
      grid[row][col] = '*';
      paint[row][col] = 'dim';
    }
  });

  // The mascot, standing on the horizon at the left.
  MASCOT_GRID.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      if (cell === 0) return;
      const col = 2 + ci * 2;
      const color = cell === 2 ? 'eyeDark' : 'steelBlue';
      stamp(skyRows + ri, col, '██', color);
    });
  });

  const lines = grid.map((row, r) =>
    row.map((ch, ci) => (ch === ' ' ? ' ' : c(ch, paint[r][ci] || 'gray'))).join('')
  );
  const border = c('.'.repeat(w), 'dim');
  return [border, ...lines, border];
}

export function centerBlock(block, width) {
  return block
    .split('\n')
    .map((line) => centerLine(line, width))
    .join('\n');
}

// A grab-bag of playful "thinking" verbs, shown at random while waiting on
// a response — same idea as Claude Code's "Boondoggling…" status line.
export const THINKING_WORDS = [
  'Pondering', 'Percolating', 'Synthesizing', 'Ruminating', 'Contemplating',
  'Calibrating', 'Number-crunching', 'Marinating', 'Untangling', 'Deliberating',
  'Formulating', 'Cross-referencing', 'Weighing options', 'Connecting dots',
  'Distilling', 'Composing', 'Reasoning', 'Brainstorming', 'Fine-tuning',
  'Mulling it over',
];

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];

// Starts a live-updating "<spinner> <word>… (Ns)" status line. Returns a
// handle with .stop(finalNote?) to clear the line and optionally print a
// short summary (e.g. "thought for 4s · 204 tokens") in its place.
export function startThinkingSpinner() {
  const word = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
  const start = Date.now();
  let frame = 0;

  process.stdout.write('\x1b[?25l'); // hide cursor
  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const spin = c(SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length], 'steelBlue');
    process.stdout.write(`\r${spin} ${c(word + '…', 'gray')} ${c(`(${elapsed}s)`, 'dim')}   `);
  }, 250);

  return {
    stop(finalNote) {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K'); // clear current line
      process.stdout.write('\x1b[?25h'); // show cursor
      if (finalNote) console.log(finalNote);
    },
  };
}

// Opens a local path or URL in the OS default application/browser — shared
// by the login flow (auth.js) and by --open for saved generated files.
export function openPath(target) {
  const platform = process.platform;
  // execFile (not exec) — passes the path as a real argument instead of a
  // shell string, so it can't get mangled by cmd.exe's quoting rules around
  // `start` (a notoriously fragile combination when built as a single string).
  const [cmd, args] =
    platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] :
    platform === 'darwin' ? ['open', [target]] :
    ['xdg-open', [target]];
  execFile(cmd, args, (err) => {
    if (err) {
      console.log('Could not open it automatically. Open this manually:');
      console.log(target);
    }
  });
}

// Recolors the input line as steelBlue whenever it starts with "/", so
// typing a slash command gives instant visual feedback that it's recognized.
// readline owns the line's rendering and has no hook for syntax highlighting,
// so this redraws the line itself right after readline updates its internal
// buffer on each keystroke. Best-effort: no-op if stdout isn't a real TTY,
// and any failure (e.g. a future Node readline internals change) is swallowed
// rather than crashing the chat.
export function enableSlashCommandHighlight(rl, promptColored, knownCommands) {
  if (!process.stdout.isTTY) return;
  const promptVisibleLen = visibleLength(promptColored);
  const known = new Set(knownCommands.map((k) => k.toLowerCase()));

  process.stdin.on('keypress', (_char, key) => {
    if (key && (key.name === 'return' || key.name === 'enter')) return;
    setImmediate(() => {
      try {
        if (rl.closed) return;
        const line = rl.line ?? '';
        // Only the "/word" token itself can be blue — everything from the
        // first space onward (the command's argument text) stays plain,
        // and it reverts to fully plain the moment the word stops being an
        // exact match (e.g. "/image" -> "/images").
        const match = line.match(/^(\/\S*)([\s\S]*)$/);
        const isRecognized = !!match && known.has(match[1].slice(1).toLowerCase());
        const text = isRecognized ? c(match[1], 'blue') + match[2] : line;
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(promptColored + text);
        readline.cursorTo(process.stdout, promptVisibleLen + rl.cursor);
      } catch {
        // Best-effort visual polish — never worth crashing the session over.
      }
    });
  });
}

// Waits for a single keypress (any key counts as "continue") without
// requiring a full Enter-terminated readline — mirrors "Press Enter to
// continue…" prompts in other CLIs.
export function waitForKeypress() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', () => {
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      resolve();
    });
  });
}