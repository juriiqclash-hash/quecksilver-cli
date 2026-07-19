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
  // Mountain-range palette — three ridges at increasing "distance", cooler
  // and lighter the farther back (atmospheric haze), darkest up close. Each
  // ridge also gets its own ░▒▓█ light-to-dark grain from peak-tip to base
  // (moonlit edge fading into shadow), layered on top of this base hue.
  mtFar: `${ESC}38;2;150;158;168m`,
  mtMid: `${ESC}38;2;92;101;112m`,
  mtNear: `${ESC}38;2;46;52;60m`,
};

export function c(text, color) {
  return `${colors[color] ?? ''}${text}${RESET}`;
}

// Strips ANSI codes to measure real visible width (so box borders line up
// even when a line contains colored text).
export function visibleLength(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// Renders a single bordered box split into two columns by one continuous
// vertical rule (│, meeting the top/bottom borders at ┬/┴) — one rectangle,
// not two separate boxes glued together, so a tall right column (like the
// mountain motif) visibly stretches the same border the left column sits
// in instead of floating outside it. With `title`, the top border reads
// "┌─ title ─...─┬─...─┐" instead of a plain rule. `leftWidth`/`rightWidth`
// are content widths (excluding padding/border); given explicitly they let
// the caller guarantee the box never grows past a pre-computed budget.
export function twoColumnBox(leftLines, rightLines, { color = 'steelBlue', padding = 1, title, leftWidth, rightWidth } = {}) {
  const lw = leftWidth ?? Math.max(0, ...leftLines.map(visibleLength));
  const rw = rightWidth ?? Math.max(0, ...rightLines.map(visibleLength));
  const pad = ' '.repeat(padding);
  const leftInner = lw + padding * 2;
  const rightInner = rw + padding * 2;
  const height = Math.max(leftLines.length, rightLines.length);

  let top;
  if (title) {
    const label = ` ${title} `;
    const trailing = Math.max(1, leftInner - 1 - visibleLength(label));
    top = c('┌─', color) + c(label, color) + c('─'.repeat(trailing), color)
      + c('┬', color) + c('─'.repeat(rightInner), color) + c('┐', color);
  } else {
    top = c('┌' + '─'.repeat(leftInner) + '┬' + '─'.repeat(rightInner) + '┐', color);
  }
  const bottom = c('└' + '─'.repeat(leftInner) + '┴' + '─'.repeat(rightInner) + '┘', color);

  const rows = [];
  for (let i = 0; i < height; i++) {
    const l = leftLines[i] ?? '';
    const r = rightLines[i] ?? '';
    const lPad = ' '.repeat(Math.max(0, lw - visibleLength(l)));
    const rPad = ' '.repeat(Math.max(0, rw - visibleLength(r)));
    rows.push(
      c('│', color) + pad + l + lPad + pad
        + c('│', color) + pad + r + rPad + pad
        + c('│', color)
    );
  }

  return [top, ...rows, bottom].join('\n');
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

// Pads with blank lines so whatever prints right after lands on the
// terminal's bottom row instead of trailing right after the welcome panel
// with a wall of unused space below it — `usedLines` is how many terminal
// rows the caller has already printed since the last clearScreen(), and
// `reserve` is how many more rows the caller is about to print itself
// (e.g. the divider + the input row). No-ops when stdout isn't a real TTY
// or the content already fills (or exceeds) the terminal.
export function padToBottom(usedLines, { reserve = 2 } = {}) {
  if (!process.stdout.isTTY) return;
  const rows = process.stdout.rows || 24;
  const blanks = rows - usedLines - reserve;
  for (let i = 0; i < blanks; i++) console.log();
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

// Deterministic per-cell noise in [0, 1) — no dependency needed for a
// two-integer hash, just enough grain to break up flat fills.
// Each of the four fractional-coverage Unicode blocks has its own *fixed*
// dot/hatch pattern baked into the glyph — used as a flat fill (not mixed
// per-cell), that fixed pattern alone is what produces a clean, regular
// halftone-illustration look. Mixing several density levels per cell was
// tried and reads as TV static instead — real texture, but chaotic rather
// than the crisp engraved look real mountain art (and this reference) has.

// A mountain-landscape backdrop for the mascot: three overlapping ridgelines
// receding into the distance (lightest/hazy far range down to a dark near
// range), scattered stars in the open sky, framed top and bottom by a
// dotted horizon line (unless `border: false`, for when it's embedded as a
// column inside a bordered box that already draws its own edges), with the
// Zora mascot standing on the near ridge at the left. Terrain is generated
// across the *entire* canvas height (sky rows + mascot rows combined), not
// just the sky band — every column's nearest ridge always reaches the very
// bottom row (min height is clamped to 1), so the range runs unbroken all
// the way down to the ground the mascot stands on, with no black gap
// between the mountain's foot and the mascot's row. Rows come back
// pre-colored and padded to `width` visible columns, ready to drop into a
// full-width splash or a welcome-panel column.
export function mountainScene(width = 60, { skyRows = 9, border = true } = {}) {
  const w = Math.max(22, width);
  const mascotRows = MASCOT_GRID.length;
  const rows = skyRows + mascotRows; // full canvas height, sky + ground

  // Farthest ridge: tallest, lightest, broadest peaks, reaching well up
  // into the sky band. Nearest ridge: shortest overall but darkest, and —
  // because every ridge's minimum height is clamped to 1 row — it always
  // touches the bottom row in every column, forming the unbroken ground
  // line the mascot stands on. Deliberately mismatched frequencies/phases
  // so the three skylines never line up — that's what reads as ranges
  // overlapping and receding into the distance rather than one repeated
  // shape (matches the reference: a tall jagged spine of peaks with a
  // smaller secondary hump peeking through the gaps, and a darker
  // foreground shoulder running along the base).
  const ridges = [
    { heights: ridgeHeights(w, { base: rows * 0.58, amp: rows * 0.24, freq: 1.05, phase: 0.15, octaves: 2 }), color: 'mtFar' },
    { heights: ridgeHeights(w, { base: rows * 0.40, amp: rows * 0.16, freq: 1.9, phase: 2.1, octaves: 2 }), color: 'mtMid' },
    { heights: ridgeHeights(w, { base: rows * 0.30, amp: rows * 0.22, freq: 1.55, phase: 3.55, octaves: 2 }), color: 'mtNear' },
  ];

  // Paint back-to-front so nearer ridges overwrite farther ones wherever
  // they overlap — that overwrite order is what creates the depth effect.
  const cell = Array.from({ length: rows }, () => Array(w).fill(null));
  ridges.forEach(({ heights, color }) => {
    for (let x = 0; x < w; x++) {
      const h = Math.max(1, Math.min(rows, Math.round(heights[x])));
      const top = rows - h;
      for (let y = top; y < rows; y++) {
        // Depth from *this ridge's own* peak tip at this column drives a
        // fixed ░▒▓█ gradient — light near the tip, solid near the base —
        // independent of the far/mid/near hue shift above. Deterministic,
        // not per-cell random noise: same depth always maps to the same
        // glyph, which is what keeps it reading as clean engraved shading
        // instead of static.
        const depth = h <= 1 ? 1 : (y - top) / (h - 1);
        const ch = depth < 0.22 ? '░' : depth < 0.5 ? '▒' : depth < 0.78 ? '▓' : '█';
        cell[y][x] = { ch, color };
      }
    }
  });

  // A handful of stars in whatever open sky is left, weighted toward the
  // upper rows where the ridges never reach.
  const starCols = [0.05, 0.22, 0.5, 0.7, 0.88, 0.96];
  starCols.forEach((frac, i) => {
    const row = i % 3;
    const col = Math.round(frac * (w - 1));
    if (!cell[row][col]) cell[row][col] = { ch: '*', color: 'dim' };
  });

  // The mascot overlays the terrain on the bottom `mascotRows` rows, at
  // the left — only its own non-empty cells replace what's underneath, so
  // the mountain terrain stays visible behind/around it instead of a
  // blank box.
  const mascotTop = rows - mascotRows;
  MASCOT_GRID.forEach((row, ri) => {
    row.forEach((cellValue, ci) => {
      if (cellValue === 0) return;
      const col = 2 + ci * 2;
      const color = cellValue === 2 ? 'eyeDark' : 'steelBlue';
      for (const dc of [0, 1]) {
        if (col + dc < w) cell[mascotTop + ri][col + dc] = { ch: '█', color };
      }
    });
  });

  const lines = cell.map((row) =>
    row.map((data) => (data ? c(data.ch, data.color) : ' ')).join('')
  );

  if (!border) return lines;
  const dots = c('.'.repeat(w), 'dim');
  return [dots, ...lines, dots];
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