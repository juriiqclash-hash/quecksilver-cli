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
  // Mountain-range palette — three ridges at increasing "distance", each
  // with a slightly lighter rim tone along its silhouette edge for a soft
  // rim-light effect. Cooler and lighter the farther back, mimicking
  // atmospheric haze; darkest and most saturated up close.
  mtFar: `${ESC}38;2;98;109;122m`,
  mtFarRim: `${ESC}38;2;134;145;158m`,
  mtMid: `${ESC}38;2;69;79;91m`,
  mtMidRim: `${ESC}38;2;95;106;119m`,
  mtNear: `${ESC}38;2;42;49;58m`,
  mtNearRim: `${ESC}38;2;61;69;80m`,
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

// The real terminal width, clamped to a sane range so the layout never
// goes absurdly narrow (piped/unknown width) or absurdly wide (huge
// monitor) — used to size every full-width screen the same way.
export function terminalWidth({ min = 60, max = 120, fallback = 80 } = {}) {
  const cols = process.stdout.columns || fallback;
  return Math.max(min, Math.min(max, cols));
}

// Clears the terminal (screen + scrollback) and homes the cursor, so a
// fresh `quecksilver` run starts flush against the top of the window
// instead of trailing after old shell scrollback — same feel as Claude
// Code's own startup screen. No-ops when stdout isn't a real TTY.
export function clearScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

// A full-width horizontal rule, framing the chat input like a text box —
// printed both above and below the readline prompt on every turn.
export function divider(width) {
  const w = width || terminalWidth();
  return c('─'.repeat(Math.max(10, w)), 'dim');
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

// A single period of a sharp-cornered triangle wave in [-1, 1] — unlike a
// sine, this has real angular peaks and valleys, which is what makes the
// stacked-octave sum below read as jagged rock instead of rolling hills.
function triangleWave(t) {
  const x = ((t % 1) + 1) % 1;
  return x < 0.5 ? 4 * x - 1 : 3 - 4 * x;
}

// A jagged ridge silhouette built from a few octaves of triangle waves —
// each pass roughly doubles the frequency and halves the amplitude (a small
// fractal/fBm sum), which is what gives a real mountain skyline its mix of
// a few big peaks with smaller, rockier detail riding on their slopes.
function ridgeHeights(width, { base, amp, freq, phase, octaves = 3 }) {
  const heights = [];
  for (let x = 0; x < width; x++) {
    const t = x / width;
    let h = base;
    let a = amp;
    let f = freq;
    for (let o = 0; o < octaves; o++) {
      h += a * triangleWave(t * f + phase + o * 0.37);
      a *= 0.5;
      f *= 2.15;
    }
    heights.push(h);
  }
  return heights;
}

// A mountain-landscape backdrop for the mascot: three overlapping ridgelines
// receding into the distance (lightest/hazy far range down to a dark near
// range), scattered stars in the open sky, framed top and bottom by a
// dotted horizon line, with the Zora mascot standing on the near ridge at
// the left. Rows come back pre-colored and padded to `width` visible
// columns, ready to drop into a full-width splash or a welcome-panel column.
export function mountainScene(width = 60, { skyRows = 9 } = {}) {
  const w = Math.max(22, width);
  const mascotRows = MASCOT_GRID.length;

  // Farthest ridge: tallest, lightest, broadest peaks. Nearest ridge:
  // shortest, darkest, busiest detail, and forms the ground line the
  // mascot stands on. Deliberately mismatched frequencies/phases so the
  // three skylines never line up — that's what reads as "alternating"
  // ranges receding into the distance rather than one repeated shape.
  const ridges = [
    {
      heights: ridgeHeights(w, { base: skyRows * 0.62, amp: skyRows * 0.30, freq: 1.3, phase: 0.15 }),
      body: 'mtFar', rim: 'mtFarRim',
    },
    {
      heights: ridgeHeights(w, { base: skyRows * 0.44, amp: skyRows * 0.26, freq: 2.1, phase: 1.85 }),
      body: 'mtMid', rim: 'mtMidRim',
    },
    {
      heights: ridgeHeights(w, { base: skyRows * 0.26, amp: skyRows * 0.22, freq: 3.0, phase: 3.4 }),
      body: 'mtNear', rim: 'mtNearRim',
    },
  ];

  // Paint back-to-front so nearer ridges overwrite farther ones wherever
  // they overlap — that overwrite order is what creates the depth effect.
  const cell = Array.from({ length: skyRows }, () => Array(w).fill(null));
  ridges.forEach(({ heights, body, rim }) => {
    for (let x = 0; x < w; x++) {
      const h = Math.max(1, Math.min(skyRows, Math.round(heights[x])));
      const top = skyRows - h;
      for (let y = top; y < skyRows; y++) cell[y][x] = y === top ? rim : body;
    }
  });

  // A handful of stars in whatever open sky is left, weighted toward the
  // upper rows where the ridges never reach.
  const starCols = [0.05, 0.22, 0.5, 0.7, 0.88, 0.96];
  starCols.forEach((frac, i) => {
    const row = i % 3;
    const col = Math.round(frac * (w - 1));
    if (!cell[row][col]) cell[row][col] = 'star';
  });

  const skyLines = cell.map((row) =>
    row.map((color) => {
      if (!color) return ' ';
      if (color === 'star') return c('*', 'dim');
      return c('█', color);
    }).join('')
  );

  // The mascot, standing on the near ridge's ground line at the left.
  const mascotChars = Array.from({ length: mascotRows }, () => Array(w).fill(' '));
  const mascotPaint = Array.from({ length: mascotRows }, () => Array(w).fill(null));
  MASCOT_GRID.forEach((row, ri) => {
    row.forEach((cellValue, ci) => {
      if (cellValue === 0) return;
      const col = 2 + ci * 2;
      const color = cellValue === 2 ? 'eyeDark' : 'steelBlue';
      for (const dc of [0, 1]) {
        if (col + dc < w) { mascotChars[ri][col + dc] = '█'; mascotPaint[ri][col + dc] = color; }
      }
    });
  });
  const mascotLines = mascotChars.map((row, r) =>
    row.map((ch, ci) => (ch === ' ' ? ' ' : c(ch, mascotPaint[r][ci]))).join('')
  );

  const border = c('.'.repeat(w), 'dim');
  return [border, ...skyLines, ...mascotLines, border];
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