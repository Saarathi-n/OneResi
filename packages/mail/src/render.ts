import { RenderError } from './errors.js';
import { contextFor, resolveOrigin, type RenderOptions } from './links.js';
import { findTemplate } from './templates/index.js';
import type { MailTemplate, RenderedMail, TemplateId } from './types.js';

/**
 * A template plus its variables to `{ subject, text, html }`, with the invariants checked on the way
 * out.
 *
 * Rendering is the choke point every message passes through, so the properties the mail suite asserts
 * are enforced here rather than trusted to thirteen files: both parts exist, the HTML needs no
 * stylesheet, and every link is absolute and on the configured origin. A template that breaks one of
 * them raises `RenderError`, which the worker treats as permanent — a broken message is not made
 * better by five more attempts, and the row says why.
 */

/** SES puts the subject in a header, so a newline in it would be a header injection. */
function normaliseSubject(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') throw new RenderError('A template produced an empty subject');
  if (collapsed.length <= 240) return collapsed;

  const cut = collapsed.slice(0, 240);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 160 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const URL_PATTERN = /\b(?:https?|ftp|file):\/\/[^\s"'<>)\]]+/gi;
const HREF_PATTERN = /href="([^"]*)"/gi;
const FORBIDDEN_HTML: readonly [RegExp, string][] = [
  [/<style[\s>]/i, 'a <style> block'],
  [/<link[\s>]/i, 'a stylesheet link'],
  [/\sclass="/i, 'a class attribute, which needs a stylesheet to mean anything'],
  [/<table[\s>]/i, 'a table, which this layout does not use'],
  [/<script[\s>]/i, 'a script'],
];

/**
 * Structural checks only. The copy rule — no use-case identifiers, nothing that reads as coursework —
 * is enforced on the *source* by the build gate and on rendered output by this package's own test,
 * deliberately not here: a title or a complaint note is written by a person, and a message must never
 * fail to send because of a word somebody chose. See `assertNoCourseworkFraming`.
 */
export function assertRenderSafe(rendered: RenderedMail, origin: string): void {
  const where = `subject "${rendered.subject}"`;

  if (rendered.text.trim() === '') {
    throw new RenderError(`No text part for ${where}; every message needs one`);
  }
  if (rendered.html.trim() === '') {
    throw new RenderError(`No HTML part for ${where}`);
  }

  for (const [pattern, description] of FORBIDDEN_HTML) {
    if (pattern.test(rendered.html)) {
      throw new RenderError(`The HTML for ${where} contains ${description}`);
    }
  }

  for (const part of [rendered.text, rendered.html]) {
    for (const match of part.matchAll(URL_PATTERN)) {
      const url = match[0];
      if (!url.startsWith(`${origin}/`) && url !== origin) {
        throw new RenderError(
          `A link in ${where} points outside the configured origin: ${url} is not on ${origin}`,
        );
      }
    }
  }

  for (const match of rendered.html.matchAll(HREF_PATTERN)) {
    const href = match[1] ?? '';
    if (href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (!href.startsWith(origin)) {
      throw new RenderError(
        `A relative or foreign link in ${where}: href="${href}". A mail client has no page to ` +
          'resolve it against, so every link is built from APP_ORIGIN.',
      );
    }
  }
}

/**
 * The patterns the build gate looks for in source, applied to rendered output. Called by this
 * package's test over every template, and available to the integration suite to sweep the whole
 * `MailMessage` table at the end of a run.
 *
 * `docs/plan/04-product-design.md` has the list. The previous build sent subjects like
 * "Password Reset Request (UC-03)" and "[OneResi Notice] … (UC-24)" (D-51).
 */
export const COURSEWORK_PATTERNS: readonly RegExp[] = [
  /UC[-\s]?\d{2}/i,
  /\bADR[-\s]?\d{4}\b/i,
  /\bBCSE\d+/i,
  /\b\d{2}BCE\d+/i,
  /\bcoursework\b/i,
  /\bsimulat(?:ed|ion|ing)\b/i,
  /\bmock(?:ed|ing)?\b/i,
  /\bdemo(?:nstration)?\b/i,
  /\bseeded\b/i,
  /\bdummy\b/i,
  /\bplaceholder\b/i,
  /\bTODO\b/,
  /\blorem ipsum\b/i,
];

export function assertNoCourseworkFraming(...parts: readonly string[]): void {
  for (const part of parts) {
    for (const pattern of COURSEWORK_PATTERNS) {
      const found = pattern.exec(part);
      if (found !== null) {
        throw new RenderError(
          `"${found[0]}" reads as coursework rather than product copy, and a resident would see it`,
        );
      }
    }
  }
}

export function render<Vars>(
  template: MailTemplate<Vars>,
  vars: Vars,
  options: RenderOptions = {},
): RenderedMail {
  const origin = resolveOrigin(options);
  const context = contextFor(origin);

  const rendered: RenderedMail = {
    subject: normaliseSubject(template.subject(vars)),
    text: template.text(vars, context),
    html: template.html(vars, context),
    variables: template.variables(vars),
  };

  assertRenderSafe(rendered, origin);
  return rendered;
}

/**
 * The worker's path: an id and the JSON a handler wrote. Decoding happens inside the template, so a
 * malformed payload is a `PayloadError` naming the field.
 */
export function renderById(
  id: TemplateId,
  payload: unknown,
  options: RenderOptions = {},
): RenderedMail {
  const template = findTemplate(id);
  if (template === undefined) {
    throw new RenderError(`No mail template for "${id}"`);
  }

  const origin = resolveOrigin(options);
  const rendered = template.render(payload, contextFor(origin));
  const checked: RenderedMail = { ...rendered, subject: normaliseSubject(rendered.subject) };

  assertRenderSafe(checked, origin);
  return checked;
}
