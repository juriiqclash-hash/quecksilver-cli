// Minimal terminal UI helpers: ANSI colors, box-drawing, and the QueckSilver
// pixel mascot — deliberately dependency-free (no chalk/boxen) so publishing
// stays simple.

import { execFile } from 'child_process';
import readline from 'readline';
import { MOUNTAIN_GRID_B64, MOUNTAIN_GRID_W, MOUNTAIN_GRID_H } from './mountain-data.js';

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

// The mountain ridge itself is not procedurally generated — it's a real
// 24-bit RGB render of the reference artwork, baked into
// src/mountain-data.js (420x43, row-major, base64), cropped down to just
// the sky+ridge band. The mascot and the stars are drawn on top by this
// file instead of taken from the source image (see below).
let _mountainRGB = null;
function mountainRGB() {
  if (!_mountainRGB) _mountainRGB = Buffer.from(MOUNTAIN_GRID_B64, 'base64');
  return _mountainRGB;
}

// Area-average box downsample: output pixel (px, py) in a wOut x hOut grid
// averages every source pixel in its corresponding box of the baked
// MOUNTAIN_GRID_W x MOUNTAIN_GRID_H source — keeps thin bright details
// (star pixels, peak highlights) from disappearing when scaled down to a
// narrow terminal column, unlike nearest-neighbor sampling.
function sampleBox(buf, px, py, wOut, hOut) {
  const x0 = Math.floor((px / wOut) * MOUNTAIN_GRID_W);
  const x1 = Math.max(x0 + 1, Math.floor(((px + 1) / wOut) * MOUNTAIN_GRID_W));
  const y0 = Math.floor((py / hOut) * MOUNTAIN_GRID_H);
  const y1 = Math.max(y0 + 1, Math.floor(((py + 1) / hOut) * MOUNTAIN_GRID_H));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1 && y < MOUNTAIN_GRID_H; y++) {
    for (let x = x0; x < x1 && x < MOUNTAIN_GRID_W; x++) {
      const idx = (y * MOUNTAIN_GRID_W + x) * 3;
      r += buf[idx]; g += buf[idx + 1]; b += buf[idx + 2];
      n++;
    }
  }
  if (n === 0) return [0, 0, 0];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function rgbColor(rgb) {
  return `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

// The source capture's own blurry baked-in mascot sits inside this source
// pixel box (rows/cols 5-70 x 41-69 of the 420x70 grid) — found by
// scanning for the bluish tint that doesn't belong to the grayscale
// terrain. Only sampleBox() boxes that actually overlap this region carry
// any of that blur; everything else is untouched, real mountain data.
const MASCOT_SOURCE_BOX = { x0: 5, x1: 70, y0: 41, y1: 69 };

function overlapsMascotSource(px, py, wOut, hOut) {
  const x0 = Math.floor((px / wOut) * MOUNTAIN_GRID_W);
  const x1 = Math.max(x0 + 1, Math.floor(((px + 1) / wOut) * MOUNTAIN_GRID_W));
  const y0 = Math.floor((py / hOut) * MOUNTAIN_GRID_H);
  const y1 = Math.max(y0 + 1, Math.floor(((py + 1) / hOut) * MOUNTAIN_GRID_H));
  return x0 < MASCOT_SOURCE_BOX.x1 && x1 > MASCOT_SOURCE_BOX.x0
    && y0 < MASCOT_SOURCE_BOX.y1 && y1 > MASCOT_SOURCE_BOX.y0;
}

// A fixed, curated set of star positions (fractions of scene width/height,
// so they scale to any terminal size), drawn as a plain small `*` glyph
// rather than a filled block — real stars in a terminal font read as tiny
// marks, not solid squares. Deliberately NOT per-cell random noise either
// (that produced visible "TV static" in an earlier pass).
const STAR_POSITIONS = [
  [0.04, 0.1], [0.16, 0.22], [0.28, 0.08], [0.4, 0.25],
  [0.52, 0.12], [0.64, 0.22], [0.76, 0.08], [0.88, 0.2],
];
const STAR_COLOR = 'gray';

// A set of "row,col" keys marking cells to render as a small `*` glyph
// instead of a terrain-colored block. A star only survives if its own
// cell AND its 4 neighbors all sample dark — checking just the center
// pixel let one star land in a dark notch between two bright peaks in an
// earlier pass, reading as "sitting on the mountain"; requiring the whole
// neighborhood to be dark keeps stars clear of ridge edges entirely.
function placeStars(pixels, w, rows) {
  const cells = new Set();
  const isDark = (py, px) => {
    const [r, g, b] = pixels[py][px];
    return r < 40 && g < 40 && b < 40;
  };
  STAR_POSITIONS.forEach(([xFrac, yFrac]) => {
    const px = Math.min(w - 1, Math.round(xFrac * (w - 1)));
    const py = Math.min(rows - 1, Math.round(yFrac * (rows - 1)));
    const neighbors = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
    const clear = neighbors.every(([dy, dx]) => {
      const ny = py + dy, nx = px + dx;
      if (ny < 0 || ny >= rows || nx < 0 || nx >= w) return true;
      return isDark(ny, nx);
    });
    if (clear) cells.add(`${py},${px}`);
  });
  return cells;
}

// A mountain-landscape backdrop for the mascot: the ridge/sky shading comes
// from the baked reference render (see mountainRGB above), while the
// mascot and the stars are drawn fresh by this function — the source
// capture's own mascot was blurry and its stars weren't ours to control,
// so neither is reused. Framed top and bottom by a dotted horizon line
// (unless `border: false`, for when it's embedded as a column inside a
// bordered box that already draws its own edges), with the Zora mascot
// standing at the left in the CLI's own brand color, drawn over the baked
// terrain. Rows come back pre-colored and padded to `width` visible
// columns, ready to drop into a full-width splash or a welcome-panel column.
export function mountainScene(width = 60, { skyRows = 9, border = true } = {}) {
  const w = Math.max(22, width);
  const mascotRows = MASCOT_GRID.length;
  const rows = skyRows + mascotRows; // character rows, sky + ground

  const buf = mountainRGB();
  const pixels = Array.from({ length: rows }, (_, py) =>
    Array.from({ length: w }, (_, px) => sampleBox(buf, px, py, w, rows))
  );

  // Only the cells whose sample box actually overlaps the source's blurry
  // baked-in mascot (see MASCOT_SOURCE_BOX) get touched — everything
  // beside it, left or right, is real untouched mountain data. Each
  // contaminated cell extends its own column's last clean row from just
  // above the mascot band straight down, so the ridge visibly continues
  // behind/around our own mascot instead of a flat blanked rectangle.
  const mascotTop = rows - mascotRows;
  for (let x = 0; x < w; x++) {
    let cleanRow = mascotTop - 1;
    while (cleanRow >= 0 && overlapsMascotSource(x, cleanRow, w, rows)) cleanRow--;
    const fill = cleanRow >= 0 ? pixels[cleanRow][x] : [0, 0, 0];
    for (let r = mascotTop; r < rows; r++) {
      if (overlapsMascotSource(x, r, w, rows)) pixels[r][x] = fill;
    }
  }

  const starCells = placeStars(pixels, w, rows);

  // The mascot overlays the terrain on the bottom `mascotRows` character
  // rows, at the left — only its own non-empty cells replace what's
  // underneath, so the baked terrain stays visible behind/around it.
  const mascotCell = Array.from({ length: rows }, () => Array(w).fill(null));
  MASCOT_GRID.forEach((row, ri) => {
    row.forEach((cellValue, ci) => {
      if (cellValue === 0) return;
      const col = 2 + ci * 2;
      const color = cellValue === 2 ? 'eyeDark' : 'steelBlue';
      for (const dc of [0, 1]) {
        if (col + dc < w) mascotCell[mascotTop + ri][col + dc] = color;
      }
    });
  });

  const lines = [];
  for (let r = 0; r < rows; r++) {
    const pixelRow = pixels[r];
    let line = '';
    for (let x = 0; x < w; x++) {
      const mColor = mascotCell[r][x];
      if (mColor) {
        line += c('█', mColor);
      } else if (starCells.has(`${r},${x}`)) {
        line += c('*', STAR_COLOR);
      } else {
        line += rgbColor(pixelRow[x]) + '█' + RESET;
      }
    }
    lines.push(line);
  }

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