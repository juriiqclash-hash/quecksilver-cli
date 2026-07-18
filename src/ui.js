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
  blue: `${ESC}34m`,
  brightBlue: `${ESC}94m`,
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
export function box(lines, { color = 'brightBlue', padding = 1, minWidth = 30 } = {}) {
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

export function mascot({ bodyColor = 'brightBlue', eyeColor = 'white' } = {}) {
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