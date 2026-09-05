import type { Block, DetailRow, RenderContext } from './types.js';

/**
 * Blocks in, two bodies out.
 *
 * A template writes the message once as a short list of blocks; this file renders that list to plain
 * text and to HTML. Consequences worth having: the two parts cannot say different things, neither can
 * be forgotten, and the HTML layout — inline styles, no stylesheet, no table — is decided in one
 * place rather than thirteen.
 */

// ---------------------------------------------------------------- block constructors

export const heading = (text: string): Block => ({ kind: 'heading', text });
export const para = (text: string): Block => ({ kind: 'para', text });
export const details = (rows: readonly DetailRow[]): Block => ({ kind: 'details', rows });
export const bullets = (items: readonly string[]): Block => ({ kind: 'bullets', items });
export const note = (text: string): Block => ({ kind: 'note', text });
export const action = (label: string, path: string): Block => ({ kind: 'action', label, path });

export const quote = (text: string, attribution?: string): Block =>
  attribution === undefined
    ? { kind: 'quote', text }
    : { kind: 'quote', text, attribution };

/** Author-written text — a notice body, a complaint note — split on blank lines. */
export function paras(raw: string): Block[] {
  return raw
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim().replace(/\s*\n\s*/g, ' '))
    .filter((chunk) => chunk !== '')
    .map(para);
}

/** Keeps a long body from turning a message into a wall. */
export function excerpt(raw: string, limit = 900): string {
  const clean = raw.trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------- plain text

const WRAP_AT = 74;

/** Greedy wrap that never breaks a word, so a URL stays clickable. */
function wrap(text: string, width = WRAP_AT): string {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

const SIGN_OFF = 'OneResi';
const FOOTER =
  'You are getting this because you have an account for your residents’ association.';

export function renderText(blocks: readonly Block[], context: RenderContext): string {
  const chunks: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        chunks.push(`${block.text}\n${'-'.repeat(Math.min(block.text.length, WRAP_AT))}`);
        break;
      case 'para':
        chunks.push(wrap(block.text));
        break;
      case 'details':
        chunks.push(block.rows.map((row) => `${row.label}: ${row.value}`).join('\n'));
        break;
      case 'quote':
        chunks.push(
          block.attribution === undefined
            ? wrap(block.text, WRAP_AT - 2)
                .split('\n')
                .map((line) => `  ${line}`)
                .join('\n')
            : `${wrap(block.text, WRAP_AT - 2)
                .split('\n')
                .map((line) => `  ${line}`)
                .join('\n')}\n  — ${block.attribution}`,
        );
        break;
      case 'bullets':
        chunks.push(
          block.items
            .map((item) =>
              wrap(item, WRAP_AT - 2)
                .split('\n')
                .map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`))
                .join('\n'),
            )
            .join('\n'),
        );
        break;
      case 'action':
        chunks.push(`${block.label}:\n${context.url(block.path)}`);
        break;
      case 'note':
        chunks.push(wrap(block.text));
        break;
      default: {
        const unreachable: never = block;
        throw new Error(`Unhandled block: ${JSON.stringify(unreachable)}`);
      }
    }
  }

  return `${chunks.join('\n\n')}\n\n${SIGN_OFF}\n${wrap(FOOTER)}\n${context.url('/')}\n`;
}

// ---------------------------------------------------------------- html

/**
 * Inline styles only — no stylesheet, no `<style>` block, no class attribute, no table. Mail clients
 * strip and rewrite CSS unpredictably, so every rule that matters travels on the element it styles,
 * and the layout degrades to readable stacked text wherever a client ignores something.
 */
const INK = '#1f2328';
const MUTED = '#5c6773';
const RULE = '#e3e7eb';
const CANVAS = '#f4f6f8';
const ACCENT = '#116b47';
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const S = {
  page: `margin:0;padding:24px 12px;background-color:${CANVAS};font-family:${FONT};`,
  card: `max-width:560px;margin:0 auto;padding:30px 28px 26px;background-color:#ffffff;border:1px solid ${RULE};border-radius:14px;`,
  brand: `margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:0.08em;color:${ACCENT};`,
  heading: `margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:700;color:${INK};`,
  para: `margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};`,
  note: `margin:0 0 14px;font-size:13px;line-height:1.6;color:${MUTED};`,
  panel: `margin:0 0 18px;padding:14px 16px;background-color:${CANVAS};border-radius:10px;`,
  row: 'margin:0 0 8px;font-size:15px;line-height:1.5;',
  label: `display:inline-block;min-width:140px;font-size:13px;color:${MUTED};`,
  value: `font-weight:600;color:${INK};`,
  quote: `margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid ${RULE};font-size:15px;line-height:1.6;color:${INK};`,
  attribution: `margin:6px 0 0;font-size:13px;color:${MUTED};`,
  list: `margin:0 0 14px;padding:0 0 0 20px;font-size:15px;line-height:1.6;color:${INK};`,
  button: `display:inline-block;margin:2px 0 18px;padding:12px 20px;background-color:${ACCENT};border-radius:9px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;`,
  footer: `max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;`,
  footerLink: `color:${MUTED};text-decoration:underline;`,
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function detailRows(rows: readonly DetailRow[]): string {
  return rows
    .map(
      (row) =>
        `<div style="${S.row}"><span style="${S.label}">${escapeHtml(row.label)}</span>` +
        `<span style="${S.value}">${escapeHtml(row.value)}</span></div>`,
    )
    .join('');
}

function htmlBlock(block: Block, context: RenderContext): string {
  switch (block.kind) {
    case 'heading':
      return `<h1 style="${S.heading}">${escapeHtml(block.text)}</h1>`;
    case 'para':
      return `<p style="${S.para}">${escapeHtml(block.text)}</p>`;
    case 'details':
      return `<div style="${S.panel}">${detailRows(block.rows)}</div>`;
    case 'quote':
      return (
        `<div style="${S.quote}">${escapeHtml(block.text)}` +
        (block.attribution === undefined
          ? ''
          : `<p style="${S.attribution}">— ${escapeHtml(block.attribution)}</p>`) +
        `</div>`
      );
    case 'bullets':
      return `<ul style="${S.list}">${block.items
        .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
        .join('')}</ul>`;
    case 'action':
      return `<p style="margin:0;"><a href="${escapeHtml(context.url(block.path))}" style="${
        S.button
      }">${escapeHtml(block.label)}</a></p>`;
    case 'note':
      return `<p style="${S.note}">${escapeHtml(block.text)}</p>`;
    default: {
      const unreachable: never = block;
      throw new Error(`Unhandled block: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function renderHtml(blocks: readonly Block[], context: RenderContext): string {
  const body = blocks.map((block) => htmlBlock(block, context)).join('');
  const origin = context.url('/');

  return (
    `<div style="${S.page}">` +
    `<div style="${S.card}">` +
    `<div style="${S.brand}">ONERESI</div>` +
    body +
    `</div>` +
    `<div style="${S.footer}">` +
    `<p style="margin:0 0 4px;">${escapeHtml(FOOTER)}</p>` +
    `<p style="margin:0;"><a href="${escapeHtml(origin)}" style="${S.footerLink}">` +
    `${escapeHtml(origin.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></p>` +
    `</div>` +
    `</div>`
  );
}

