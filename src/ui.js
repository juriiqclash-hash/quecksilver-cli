// Minimal terminal UI helpers: ANSI colors, box-drawing, and the QueckSilver
// pixel mascot — deliberately dependency-free (no chalk/boxen) so publishing
// stays simple.

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

// Renders a bordered box around the given lines.
export function box(lines, { color = 'steelBlue', padding = 1, minWidth = 30 } = {}) {
  const contentWidth = Math.max(minWidth, ...lines.map(visibleLength));
  const innerWidth = contentWidth + padding * 2;
  const top = c('┌' + '─'.repeat(innerWidth) + '┐', color);
  const bottom = c('└' + '─'.repeat(innerWidth) + '┘', color);
  const pad = ' '.repeat(padding);

  const body = lines.map((line) => {
    const visLen = visibleLength(line);
    const rightPad = ' '.repeat(contentWidth - visLen);
    return c('│', color) + pad + line + rightPad + pad + c('│', color);
  });

  return [top, ...body, bottom].join('\n');
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