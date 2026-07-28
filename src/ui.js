// Minimal terminal UI helpers: ANSI colors, box-drawing, and the QueckSilver
// pixel mascot — deliberately dependency-free (no chalk/boxen) so publishing
// stays simple.

import { execFile } from 'child_process';
import readline from 'readline';
import { MOUNTAIN_GRID_B64, MOUNTAIN_GRID_W, MOUNTAIN_GRID_H } from './mountain-data.js';
import { LOGO_GRID_B64, LOGO_GRID_W, LOGO_GRID_H } from './logo-data.js';

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
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
export function visibleLength(str) {
  return str.replace(ANSI_PATTERN, '').length;
}

// Greedy word-wrap that treats each whitespace-separated token as a single
// unit for width purposes, measuring by *visible* length — so a token that
// already carries inline ANSI styling (e.g. a bolded word from
// renderMarkdown below) doesn't get over-counted by its escape codes.
export function wrapText(text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = [];
  let currentLen = 0;
  for (const word of words) {
    const len = visibleLength(word);
    const sep = current.length ? 1 : 0;
    if (currentLen + sep + len > maxWidth && current.length) {
      lines.push(current.join(' '));
      current = [word];
      currentLen = len;
    } else {
      current.push(word);
      currentLen += sep + len;
    }
  }
  if (current.length) lines.push(current.join(' '));
  return lines;
}

// Centers a block of (possibly colored) lines together as one unit — every
// line gets the same left padding, derived from the block's widest line,
// so lines meant to stay mutually aligned (e.g. "Label: value" rows
// sharing a label column) keep that alignment instead of each drifting to
// its own individual center. The caller's box-drawing already right-pads
// to column width, so only left padding needs adding here.
export function centerBlock(lines, width) {
  const maxLen = Math.max(0, ...lines.map(visibleLength));
  const left = Math.floor(Math.max(0, width - maxLen) / 2);
  return lines.map((line) => ' '.repeat(left) + line);
}

// Renders a single bordered box split into two columns by one continuous
// vertical rule (│, meeting the top/bottom borders at ┬/┴) — one rectangle,
// not two separate boxes glued together, so a tall right column (like the
// mountain motif) visibly stretches the same border the left column sits
// in instead of floating outside it. With `title`, the top border reads
// "┌─ title ─...─┬─...─┐" instead of a plain rule. `leftWidth`/`rightWidth`
// are content widths (excluding padding/border); given explicitly they let
// the caller guarantee the box never grows past a pre-computed budget.
// `dividerInset` makes the vertical rule "float" — it's left out of the
// top/bottom `dividerInset` rows (rendered as plain space there instead),
// and the border itself becomes a plain, unbroken rule with no ┬/┴ mark,
// since the rule no longer actually touches it.
export function twoColumnBox(leftLines, rightLines, { color = 'steelBlue', padding = 1, title, leftWidth, rightWidth, dividerInset = 0 } = {}) {
  const lw = leftWidth ?? Math.max(0, ...leftLines.map(visibleLength));
  const rw = rightWidth ?? Math.max(0, ...rightLines.map(visibleLength));
  const pad = ' '.repeat(padding);
  const leftInner = lw + padding * 2;
  const rightInner = rw + padding * 2;
  const height = Math.max(leftLines.length, rightLines.length);
  const junction = dividerInset > 0 ? '─' : '┬';
  const bottomJunction = dividerInset > 0 ? '─' : '┴';

  let top;
  if (title) {
    const label = ` ${title} `;
    const trailing = Math.max(1, leftInner - 1 - visibleLength(label));
    top = c('╭─', color) + c(label, color) + c('─'.repeat(trailing), color)
      + c(junction, color) + c('─'.repeat(rightInner), color) + c('╮', color);
  } else {
    top = c('╭' + '─'.repeat(leftInner) + junction + '─'.repeat(rightInner) + '╮', color);
  }
  const bottom = c('╰' + '─'.repeat(leftInner) + bottomJunction + '─'.repeat(rightInner) + '╯', color);

  const rows = [];
  for (let i = 0; i < height; i++) {
    const l = leftLines[i] ?? '';
    const r = rightLines[i] ?? '';
    const lPad = ' '.repeat(Math.max(0, lw - visibleLength(l)));
    const rPad = ' '.repeat(Math.max(0, rw - visibleLength(r)));
    const showDivider = i >= dividerInset && i < height - dividerInset;
    const dividerChar = showDivider ? c('│', color) : ' ';
    rows.push(
      c('│', color) + pad + l + lPad + pad
        + dividerChar + pad + r + rPad + pad
        + c('│', color)
    );
  }

  return [top, ...rows, bottom].join('\n');
}

// The real terminal width, clamped to a sane range so the layout never
// goes absurdly narrow (piped/unknown width) or absurdly wide (huge
// monitor) — used to size every full-width screen the same way.
export function terminalWidth({ min = 60, max = 120, fallback = 80 } = {}) {
  // Reserve the terminal's own last column rather than reporting the full
  // width. Writing a box/rule/status line all the way out to that exact
  // last column runs into each terminal's own edge/auto-wrap handling —
  // observed as the box's right border and the footer's status text both
  // getting clipped a character short on some terminals (Windows Terminal/
  // PowerShell among them). One column of margin avoids that ambiguity
  // everywhere this width is used, at a cosmetically unnoticeable cost.
  const cols = (process.stdout.columns || fallback) - 1;
  // The returned width must never exceed the terminal's *real* current
  // column count, even when that's narrower than `min` — every box/rule
  // this powers assumes one logical line = one physical terminal row, and
  // the moment a "line" is wider than the actual window, the terminal
  // wraps it into two rows behind our back. That single extra row is
  // enough to desync all the fixed-offset cursor math further down (in
  // readBoxedInput especially), which is what produced the mangled
  // layout when the window was narrowed below ~80 columns. Clamping the
  // lower bound to `cols` (instead of always enforcing `min`) keeps the
  // box intentionally narrower on a small window rather than wrapped.
  return Math.max(Math.min(min, cols), Math.min(max, cols));
}

// Clears the terminal (screen + scrollback) and homes the cursor, so a
// fresh `quecksilver` run starts flush against the top of the window
// instead of trailing after old shell scrollback — same feel as Claude
// Code's own startup screen. No-ops when stdout isn't a real TTY.
export function clearScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

// Sets the terminal window/tab title (the OSC 0 sequence — widely
// supported, including Windows Terminal/PowerShell) so the tab reads
// "QueckSilver CLI" instead of whatever shell/binary name the terminal
// falls back to by default. No-ops when stdout isn't a real TTY.
export function setTerminalTitle(title) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

// A full-width horizontal rule, framing the chat input like a text box —
// printed both above and below the readline prompt on every turn.
export function divider(width) {
  const w = width || terminalWidth();
  return c('─'.repeat(Math.max(10, w)), 'dim');
}

// Renders a single chat message the person just submitted as one
// highlighted, full-width bar — the terminal equivalent of the shaded
// "you said" row a chat UI shows above its reply, instead of leaving the
// raw input box (rule/text/rule/status) sitting in the scrollback as if it
// were still live. Long messages wrap with a 2-space hanging indent so the
// leading "› " marker only ever appears once.
export function userMessageBlock(text, width) {
  const w = Math.max(10, width || terminalWidth());
  const bg = `${ESC}48;2;38;40;46m`;
  const fg = `${ESC}38;2;226;227;230m`;
  const marker = '› ';
  const wrapped = wrapText(text, w - marker.length) ;
  const bodyLines = wrapped.length > 0 ? wrapped : [''];
  return bodyLines.map((line, i) => {
    const prefix = i === 0 ? marker : '  ';
    const content = prefix + line;
    const pad = ' '.repeat(Math.max(0, w - visibleLength(content)));
    return `${bg}${fg}${content}${pad}${RESET}`;
  }).join('\n');
}

// A small, dependency-free Markdown -> ANSI renderer for chat replies.
// Model output routinely comes back as literal Markdown (**bold**, "- "
// bullets, "###" headings, "***" rules, fenced code) — printing that
// straight to a terminal just shows the raw punctuation. This walks the
// text block-by-block (headings, lists, blockquotes, code fences, rule
// lines, paragraphs) and turns each into something a terminal can actually
// render: real bold/italic escapes, "•" bullets, a dim vertical bar for
// quotes, and word-wrapped paragraphs — with blank-line spacing between
// blocks so the result reads like prose instead of a wall of text.
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const RULE_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE_RE = /^```/;

// Inline spans only — block-level markers (headings, bullets, quote bars)
// are stripped by the caller before this ever sees the line, so "* item"
// can never be mistaken for italic here.
function inlineFormat(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => c(code, 'blue'))
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `${colors.bold}${a ?? b}${RESET}`)
    .replace(/(?<![*\w])\*([^\s*][^*]*?)\*(?!\w)|(?<![_\w])_([^\s_][^_]*?)_(?!\w)/g,
      (_, a, b) => `${ESC}3m${a ?? b}${ESC}23m`);
}

export function renderMarkdown(text, width) {
  const w = Math.max(20, width || terminalWidth());
  const rawLines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let paragraph = [];
  let inCode = false;
  let lastWasBlank = true; // suppresses a leading blank line at the very top
  // A description that follows a list item, indented but with no marker of
  // its own (the "1. **Label**\n   explanation" shape models commonly
  // produce), reads as its own flush-left paragraph unless it's tracked as
  // still belonging to that item — this carries the item's hanging indent
  // forward across such continuation lines until real flush-left text or a
  // new block ends it.
  let listIndent = null;
  let paragraphIndent = '';

  const pushBlank = () => {
    if (!lastWasBlank) out.push('');
    lastWasBlank = true;
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const joined = inlineFormat(paragraph.join(' '));
    const indent = paragraphIndent;
    wrapText(joined, Math.max(10, w - indent.length)).forEach((l) => out.push(indent + l));
    paragraph = [];
    paragraphIndent = '';
    lastWasBlank = false;
  };

  for (const raw of rawLines) {
    const line = raw.replace(/\s+$/, '');

    if (FENCE_RE.test(line)) {
      flushParagraph();
      listIndent = null;
      inCode = !inCode;
      if (!inCode) lastWasBlank = false;
      continue;
    }
    if (inCode) {
      out.push(c('▏ ', 'dim') + c(raw, 'gray'));
      lastWasBlank = false;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      pushBlank();
      continue;
    }

    if (RULE_RE.test(line)) {
      flushParagraph();
      listIndent = null;
      pushBlank();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      listIndent = null;
      pushBlank();
      out.push(`${colors.bold}${c(inlineFormat(heading[2]), 'steelBlue')}${RESET}`);
      lastWasBlank = false;
      pushBlank();
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flushParagraph();
      const indent = '  '.repeat(Math.floor(bullet[1].length / 2));
      const marker = `${indent}${c('•', 'steelBlue')} `;
      const body = inlineFormat(bullet[2]);
      const wrapped = wrapText(body, Math.max(10, w - visibleLength(marker)));
      wrapped.forEach((l, i) => out.push((i === 0 ? marker : ' '.repeat(visibleLength(marker))) + l));
      listIndent = ' '.repeat(visibleLength(marker));
      lastWasBlank = false;
      continue;
    }

    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      flushParagraph();
      const indent = '  '.repeat(Math.floor(ordered[1].length / 2));
      const marker = `${indent}${c(`${ordered[2]}.`, 'steelBlue')} `;
      const body = inlineFormat(ordered[3]);
      const wrapped = wrapText(body, Math.max(10, w - visibleLength(marker)));
      wrapped.forEach((l, i) => out.push((i === 0 ? marker : ' '.repeat(visibleLength(marker))) + l));
      listIndent = ' '.repeat(visibleLength(marker));
      lastWasBlank = false;
      continue;
    }

    const quote = line.match(QUOTE_RE);
    if (quote) {
      flushParagraph();
      listIndent = null;
      const marker = c('│ ', 'dim');
      const wrapped = wrapText(inlineFormat(quote[1]), Math.max(10, w - visibleLength(marker)));
      wrapped.forEach((l) => out.push(marker + l));
      lastWasBlank = false;
      continue;
    }

    // Plain text. Only treated as a list continuation when it's both
    // indented in the source AND a list item is still active — flush-left
    // text always ends the list's hanging-indent context.
    const isIndented = /^\s/.test(raw);
    if (isIndented && listIndent !== null) {
      if (paragraph.length === 0) paragraphIndent = listIndent;
    } else {
      listIndent = null;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();

  // Trim any trailing blank line left by the last block's own spacing.
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// Turns a named color into its background-color escape (same RGB triplet,
// "48;2;" instead of "38;2;") — used by the half-block mascot renderer
// below, where one glyph needs a foreground color for its top pixel and a
// background color for its bottom pixel in the same cell.
function bgEscape(colorName) {
  return colors[colorName].replace('38;2;', '48;2;');
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

// Renders the mascot at roughly half its previous on-screen height by
// packing two grid rows into every terminal row with a half-block glyph:
// "▀" paints its top half in the foreground color and its bottom half in
// the background color, so a pair of grid rows (top pixel, bottom pixel)
// becomes one real terminal row instead of two. Cells that are empty in
// both source rows stay a plain space (fully transparent); cells empty in
// only one of the two rows use "▀"/"▄" with no background set at all, so
// the empty half shows the terminal's own background instead of a colored
// block — same transparency the rest of the mascot already relies on.
export function mascot({ bodyColor = 'steelBlue', eyeColor = 'eyeDark' } = {}) {
  const colorOf = (cell) => (cell === 2 ? eyeColor : cell === 1 ? bodyColor : null);
  const lines = [];
  for (let r = 0; r < MASCOT_GRID.length; r += 2) {
    const topRow = MASCOT_GRID[r];
    const botRow = MASCOT_GRID[r + 1] ?? topRow.map(() => 0);
    let line = '';
    for (let col = 0; col < topRow.length; col++) {
      const top = colorOf(topRow[col]);
      const bot = colorOf(botRow[col]);
      if (!top && !bot) {
        line += ' ';
      } else if (top && bot) {
        line += `${colors[top]}${bgEscape(bot)}▀${RESET}`;
      } else if (top) {
        line += `${colors[top]}▀${RESET}`;
      } else {
        line += `${colors[bot]}▄${RESET}`;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
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
  // beside it, left or right, is real untouched mountain data. At body
  // height, a contaminated cell borrows its nearest *un*contaminated
  // neighbor in the same row (the ridge's brightness at a given height
  // varies smoothly across columns, so this follows its actual shape) —
  // extending straight down from the row above failed here, since at the
  // far-left columns the ridge simply hasn't risen yet that high up, so
  // "the row above" was itself already pre-ridge black. At leg/ground
  // height there's nothing to borrow — the mascot stands on flat ground,
  // not on a floating patch of ridge — so those rows are forced black.
  const mascotTop = rows - mascotRows;
  const legRowsFrom = mascotTop + mascotRows - 2;
  for (let r = mascotTop; r < rows; r++) {
    if (r >= legRowsFrom) {
      for (let x = 0; x < w; x++) {
        if (overlapsMascotSource(x, r, w, rows)) pixels[r][x] = [0, 0, 0];
      }
      continue;
    }
    for (let x = 0; x < w; x++) {
      if (!overlapsMascotSource(x, r, w, rows)) continue;
      let left = x - 1;
      while (left >= 0 && overlapsMascotSource(left, r, w, rows)) left--;
      let right = x + 1;
      while (right < w && overlapsMascotSource(right, r, w, rows)) right++;
      const leftDist = left >= 0 ? x - left : Infinity;
      const rightDist = right < w ? right - x : Infinity;
      if (leftDist === Infinity && rightDist === Infinity) pixels[r][x] = [0, 0, 0];
      else pixels[r][x] = leftDist <= rightDist ? pixels[r][left] : pixels[r][right];
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

let _logoRGB = null;
function logoRGB() {
  if (!_logoRGB) _logoRGB = Buffer.from(LOGO_GRID_B64, 'base64');
  return _logoRGB;
}

// Same box-average downsample as sampleBox() above, but parameterized so
// it can be reused against a differently-sized baked grid (the logo is
// 420x34, not 420x70).
function sampleBoxGrid(buf, gridW, gridH, px, py, wOut, hOut) {
  const x0 = Math.floor((px / wOut) * gridW);
  const x1 = Math.max(x0 + 1, Math.floor(((px + 1) / wOut) * gridW));
  const y0 = Math.floor((py / hOut) * gridH);
  const y1 = Math.max(y0 + 1, Math.floor(((py + 1) / hOut) * gridH));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1 && y < gridH; y++) {
    for (let x = x0; x < x1 && x < gridW; x++) {
      const idx = (y * gridW + x) * 3;
      r += buf[idx]; g += buf[idx + 1]; b += buf[idx + 2];
      n++;
    }
  }
  if (n === 0) return [0, 0, 0];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// The QueckSilver text logo (baked reference image, see logo-data.js),
// shown on the logged-out splash instead of the mountain motif. Rows
// scale proportionally with the requested width, preserving the source
// capture's own aspect ratio — it was captured directly from a terminal,
// so it's already correctly proportioned for terminal character cells.
// Pixels this dark (in all three channels) are the source capture's black
// backdrop, not part of the wordmark itself — printed as a plain space
// instead of a colored block so the terminal's own background shows
// through, rather than a solid black rectangle sitting on top of it.
const LOGO_BG_THRESHOLD = 20;

export function logoArt(width = 80) {
  const w = Math.max(20, width);
  const rows = Math.max(1, Math.round((LOGO_GRID_H / LOGO_GRID_W) * w));
  const buf = logoRGB();
  const lines = [];
  for (let py = 0; py < rows; py++) {
    let line = '';
    for (let px = 0; px < w; px++) {
      const rgb = sampleBoxGrid(buf, LOGO_GRID_W, LOGO_GRID_H, px, py, w, rows);
      const isBackground = rgb[0] < LOGO_BG_THRESHOLD && rgb[1] < LOGO_BG_THRESHOLD && rgb[2] < LOGO_BG_THRESHOLD;
      line += isBackground ? ' ' : rgbColor(rgb) + '█' + RESET;
    }
    lines.push(line);
  }
  return lines;
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

// ---- Fixed-bottom chat dock ---------------------------------------------
//
// A permanent input box pinned to the terminal's last `FOOTER_ROWS` rows,
// with the conversation above it fully scrollable. Two problems earlier
// passes at this ran into, and how this version avoids them:
//
// 1. A plain VT100 scroll region (DECSTBM) only constrains *program-driven*
//    scrolling (newlines). It does nothing to a terminal's own mouse-wheel
//    /scrollbar scrollback — that's just replaying past frames of the
//    *whole* screen, footer rows included, so scrolling up visibly dragged
//    the box along with the conversation. Leaving the primary screen's
//    native scrollback out of the picture (switching to the alternate
//    screen buffer, same as vim/htop/tmux) fixes the box-dragging, but on
//    its own it also throws away any way to scroll back through history at
//    all. This version keeps its own scrollback instead: every printed
//    line is kept in `contentLines`, and the content viewport (rows
//    1..regionBottom) is redrawn from a window into that array — live at
//    the tail by default, moved back by PageUp/PageDown or the arrow keys
//    (which is what most terminals actually send for mouse-wheel scroll
//    while an alt-screen app hasn't requested real mouse reporting). The
//    footer is never part of that array, so it can never be scrolled.
// 2. Re-installing raw mode and a fresh keypress listener on every single
//    turn (an early version's `input()`, called once per message) left a
//    window between turns — while a reply was streaming in — where raw
//    mode had been restored to whatever it was *before* chatting started
//    (usually off). Anything typed during that window got echoed straight
//    to the terminal by the OS's own cooked-mode line editing instead of
//    by this code, landing wherever the cursor happened to be, then got
//    flushed as a garbled burst (sometimes read as a stray Enter) the
//    moment the next turn's listener came up. Raw mode and the keypress
//    listener are now installed exactly once, for the dock's entire
//    lifetime: typing is always captured live and redrawn into the box,
//    and Enter only resolves a turn when one is actually pending
//    (`pendingResolve` set) — while a reply is in flight there's nothing
//    pending, so Enter is simply swallowed and whatever was typed just
//    keeps sitting in the box, exactly as-is, until the next turn opens.
const FOOTER_ROWS = 4;
const ENTER_ALT_SCREEN = `${ESC}?1049h`;
const LEAVE_ALT_SCREEN = `${ESC}?1049l`;

// Returns the cursor-position escape rather than writing it directly —
// every redraw below builds one big string out of these and writes it in
// a single process.stdout.write() call. Issuing a separate write() per row
// (the previous approach) let the terminal paint each row as its own
// flush, which on most emulators shows up as visible flicker, especially
// under the rapid-fire redraws a scroll keypress triggers; one write is
// effectively one atomic paint.
function moveTo(row, col = 1) {
  return `${ESC}${row};${col}H`;
}
// Erase-to-end-of-line, used *after* writing a row's new content instead
// of clearing the row first — going straight from the old content to
// (new content + erased remainder) avoids the "blank, then redraw" flash
// a clear-then-write sequence produces.
const ERASE_EOL = `${ESC}K`;
// The footer's own width — matches the welcome panel/message bar's own
// {min:80,max:200} elsewhere in this file. The default terminalWidth()
// (max 120) was narrower than that, so on any terminal wider than 120
// columns the input rule and status line visibly stopped short of the
// panel's own right edge above them instead of lining up with it.
const footerWidth = () => terminalWidth({ min: 80, max: 200 });

export function createChatDock() {
  let regionBottom = Math.max(1, (process.stdout.rows || 24) - FOOTER_ROWS); // content viewport = rows 1..regionBottom
  let active = false; // alternate screen entered, raw mode + listeners live
  let engaged = false; // engage() has run: geometry is real, footer has content to show
  let exitHookInstalled = false;
  let contentLines = []; // the dock's own scrollback — every committed line, oldest first
  let stagingLine = null; // an uncommitted trailing line (the spinner) shown appended after contentLines, replaced wholesale on every tick instead of growing the real log
  let scrollOffset = 0; // lines back from the live tail; 0 = pinned to the latest content
  let buf = '';
  let pendingResolve = null;
  let statusText = '';
  let known = new Set();
  let wasRaw = false;

  const applyGeometry = () => {
    regionBottom = Math.max(1, (process.stdout.rows || 24) - FOOTER_ROWS);
  };

  const placeholder = 'Try "/commands" to see what you can do';
  const highlightedBuf = () => {
    const match = buf.match(/^(\/\S*)([\s\S]*)$/);
    if (match && known.has(match[1].slice(1).toLowerCase())) {
      return c(match[1], 'blue') + match[2];
    }
    return buf;
  };

  // Builds the footer's 4 rows as one escape-sequence string (not written
  // yet) — shared by drawFooter() (a lone keystroke, where only the footer
  // needs to change) and redrawContent() (which folds this into its own
  // single write so a content change repaints in one atomic go too).
  const footerFrame = () => {
    const w = footerWidth();
    const rule = divider(w);
    const shown = buf ? highlightedBuf() : c(placeholder, 'dim');
    const statusPad = ' '.repeat(Math.max(0, w - statusText.length));
    const lines = [rule, c('› ', 'steelBlue') + shown, rule, statusPad + c(statusText, 'dim')];
    const top = regionBottom + 1;
    let frame = '';
    lines.forEach((line, i) => {
      frame += moveTo(top + i, 1) + line + ERASE_EOL;
    });
    frame += moveTo(top + 1, 3 + buf.length);
    return frame;
  };

  const drawFooter = () => {
    if (!engaged) return;
    process.stdout.write(footerFrame());
  };

  // Redraws the whole content viewport from whatever `regionBottom` lines
  // of contentLines (plus the ephemeral staging line, if any) the current
  // scroll offset points at, then always finishes by parking the cursor
  // back in the input box — every content change goes through this, so
  // the blinking cursor never drifts up into the content area the way it
  // did when only the box's own keystroke handler bothered to reposition it.
  // The whole frame (every content row plus the footer) is assembled into
  // one string and written once, same reasoning as footerFrame() above.
  const redrawContent = () => {
    if (!engaged) return;
    const all = stagingLine !== null ? contentLines.concat([stagingLine]) : contentLines;
    const h = regionBottom;
    const maxOffset = Math.max(0, all.length - h);
    if (scrollOffset > maxOffset) scrollOffset = maxOffset;
    const start = Math.max(0, all.length - h - scrollOffset);
    let frame = '';
    for (let i = 0; i < h; i++) {
      frame += moveTo(i + 1, 1) + (all[start + i] ?? '') + ERASE_EOL;
    }
    frame += footerFrame();
    process.stdout.write(frame);
  };

  // delta > 0 reveals older lines (scroll up / PageUp), delta < 0 moves
  // back toward the live tail (scroll down / PageDown) — clamped in
  // redrawContent(). A single mouse-wheel notch typically arrives as a
  // burst of several arrow-key sequences in one go (that's the whole
  // mechanism this relies on — see the file-level comment above), which
  // used to mean one full viewport redraw *per key* in that burst:
  // technically flicker-free on its own, but several redraws stepping
  // through in a row read as sluggish, stuttery scrolling rather than one
  // smooth jump. Accumulating the deltas from an entire burst and only
  // actually redrawing once, on setImmediate (which runs only after every
  // keypress Node has already parsed out of the current input chunk has
  // fired), turns that whole burst into the single jump it visually should be.
  let pendingScroll = 0;
  let scrollFlushQueued = false;
  const scrollBy = (delta) => {
    pendingScroll += delta;
    if (scrollFlushQueued) return;
    scrollFlushQueued = true;
    setImmediate(() => {
      scrollFlushQueued = false;
      scrollOffset = Math.max(0, scrollOffset + pendingScroll);
      pendingScroll = 0;
      redrawContent();
    });
  };

  const leaveScreen = () => {
    process.stdout.write(LEAVE_ALT_SCREEN);
    if (process.stdin.setRawMode) process.stdin.setRawMode(wasRaw ?? false);
  };

  const onKeypress = (str, key) => {
    if (!active) return;
    if (key && key.ctrl && key.name === 'c') {
      dock.stop();
      process.stdout.write('\n');
      process.exit(0);
      return;
    }
    if (key && key.name === 'pageup') { scrollBy(Math.max(1, regionBottom - 1)); return; }
    if (key && key.name === 'pagedown') { scrollBy(-Math.max(1, regionBottom - 1)); return; }
    // 3 lines per key, not 1 — matches the usual "one wheel notch" amount
    // most terminals/OSes scroll by default, so a notch (however many of
    // these arrive for it — see the scrollBy comment) reads as a normal
    // scroll instead of the barely-there single-line creep 1 produced.
    if (key && key.name === 'up') { scrollBy(3); return; }
    if (key && key.name === 'down') { scrollBy(-3); return; }
    if (key && (key.name === 'return' || key.name === 'enter')) {
      // No turn is currently pending — either still on the welcome screen
      // before engage(), or a reply is actively streaming in. Either way,
      // this Enter has nothing to submit to; swallow it rather than losing
      // or misapplying whatever's already been typed.
      if (!pendingResolve) return;
      const submitted = buf;
      buf = '';
      const resolve = pendingResolve;
      pendingResolve = null;
      drawFooter();
      resolve(submitted);
      return;
    }
    if (key && key.name === 'backspace') {
      buf = buf.slice(0, -1);
      drawFooter();
      return;
    }
    if (str && !key.ctrl && !key.meta) {
      buf += str;
      drawFooter();
    }
  };

  const onResize = () => {
    if (!engaged) return;
    applyGeometry();
    redrawContent();
  };

  const dock = {
    // Switches to the alternate screen buffer and starts capturing input
    // for the rest of the process's life — call once, before printing the
    // welcome panel/intro (which then render into this fresh, blank
    // buffer instead of the shell's normal scrollback).
    start() {
      if (!process.stdout.isTTY) return;
      active = true;
      process.stdout.write(ENTER_ALT_SCREEN);
      setTerminalTitle('QueckSilver CLI');
      wasRaw = process.stdin.isRaw;
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.setRawMode) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
      process.stdout.on('resize', onResize);
      // The alternate screen and raw mode are terminal/process state that
      // outlives this process if left set on an abrupt exit (an uncaught
      // error, a raw process.exit elsewhere) — this is a last-resort net;
      // leaveScreen() is harmless to call even when nothing is active.
      if (!exitHookInstalled) {
        exitHookInstalled = true;
        process.once('exit', () => { if (active) leaveScreen(); });
      }
    },
    // Call once, right after start() — computes the content/footer split
    // from the current terminal size and draws the (still-empty) footer.
    // The welcome panel/intro print through print() below afterward, same
    // as any other content, instead of being seeded in some special way.
    engage({ statusText: st = '', knownCommands = [] } = {}) {
      if (!active) return;
      engaged = true;
      statusText = st;
      known = new Set(knownCommands.map((k) => k.toLowerCase()));
      applyGeometry();
      redrawContent();
    },
    stop() {
      if (!active) return;
      active = false;
      engaged = false;
      process.stdin.removeListener('keypress', onKeypress);
      process.stdout.removeListener('resize', onResize);
      leaveScreen();
    },
    // The content buffer's current length — pairs with truncateTo() to cut
    // a specific block (the "Type your message..." onboarding hint) back
    // out once real chatting starts, without touching anything printed
    // before it (the welcome panel) or the footer, which was never part
    // of this buffer to begin with.
    mark() {
      return contentLines.length;
    },
    truncateTo(n) {
      if (!engaged) return;
      contentLines.length = Math.max(0, n);
      scrollOffset = 0;
      redrawContent();
    },
    // Commits a (possibly multi-line) block to the end of the scrollback,
    // snaps the view back to the live tail (matching how every real chat
    // UI auto-scrolls on new content), and redraws.
    print(text = '') {
      if (!engaged) { console.log(text); return; }
      stagingLine = null;
      String(text).split('\n').forEach((line) => contentLines.push(line));
      scrollOffset = 0;
      redrawContent();
    },
    // Shows `text` as an uncommitted trailing line — appended after
    // whatever's already committed, replaced wholesale on every call
    // instead of growing the real log. Built for the spinner (see
    // spinner() below): each tick just re-stages its current frame.
    setEphemeral(text) {
      if (!engaged) return;
      stagingLine = text;
      redrawContent();
    },
    clearEphemeral() {
      if (!engaged || stagingLine === null) return;
      stagingLine = null;
      redrawContent();
    },
    // A startThinkingSpinner()-alike that renders through the dock's own
    // ephemeral line instead of a raw \r-based terminal write — the raw
    // version assumes it owns "the current line" outright, which doesn't
    // hold here now that content is a full redrawn viewport rather than
    // one growing tail. Same "<spinner> <word>… (Ns)" look and the same
    // .stop(finalNote?) shape, so call sites can take either interchangeably.
    spinner() {
      const word = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
      const start = Date.now();
      let frame = 0;
      const tick = () => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const spin = c(SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length], 'steelBlue');
        dock.setEphemeral(`${spin} ${c(word + '…', 'gray')} ${c(`(${elapsed}s)`, 'dim')}`);
      };
      tick();
      const interval = setInterval(tick, 250);
      return {
        stop(finalNote) {
          clearInterval(interval);
          dock.clearEphemeral();
          if (finalNote) dock.print(finalNote);
        },
      };
    },
    // Resolves the next time Enter is pressed while no other turn is
    // pending. Whatever's already in the box (typed while the previous
    // reply was still streaming in — see the onKeypress note above) is
    // exactly what a person sees and can keep editing; nothing is cleared
    // out from under them just because a new turn opened up.
    nextMessage() {
      return new Promise((resolve) => {
        pendingResolve = resolve;
        drawFooter();
      });
    },
  };
  return dock;
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

// Keeps the process alive for a short window purely so a static screen
// (like the logged-out banner) has a chance to redraw itself if the
// window is resized/zoomed right after it's printed — otherwise the
// program has already exited by the time anyone could resize it, and
// there's no running code left to react. Deliberately does NOT touch
// stdin (unlike waitForKeypress): reading raw keystrokes here to let
// someone skip the wait early would risk swallowing the first character
// of whatever shell command they type next, once this process exits.
export function waitBriefly({ ms = 2000, onResize } = {}) {
  return new Promise((resolve) => {
    if (!process.stdout.isTTY) {
      resolve();
      return;
    }
    if (onResize) process.stdout.on('resize', onResize);
    setTimeout(() => {
      if (onResize) process.stdout.removeListener('resize', onResize);
      resolve();
    }, ms);
  });
}
