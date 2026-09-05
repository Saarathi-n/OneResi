import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_CATEGORY } from '@oneresi/contracts';
import {
  action,
  details,
  excerpt,
  heading,
  note,
  paras,
  renderHtml,
  renderText,
} from '../document.js';
import { asObject, date, int, oneOf, optDate, str } from '../decode.js';
import { formatDate, formatDateTime } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, DetailRow, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * A notice from the committee.
 *
 * One row per recipient, written by the handler for the residents it is actually for. Posting a notice
 * previously awaited one send per active resident inside the request, sequentially (D-29).
 *
 * The title and body are the committee's own words. They are escaped, never interpreted, and the copy
 * gate is not applied to them at delivery time — a resident's or a committee member's wording must not
 * be able to stop a legitimate notice going out. See render.ts.
 */

export interface AnnouncementPublishedVars {
  readonly announcementId: number;
  readonly title: string;
  readonly body: string;
  readonly category: (typeof ANNOUNCEMENT_CATEGORIES)[number];
  readonly authorName: string;
  readonly publishedAt: Date;
  /** UC-24's expiry, restored to the model after the previous schema dropped the column (D-46). */
  readonly expiresOn?: Date;
}

export type AnnouncementPublishedPayload = Wire<AnnouncementPublishedVars>;

function compose(vars: AnnouncementPublishedVars): Block[] {
  const rows: DetailRow[] = [
    { label: 'Posted by', value: vars.authorName },
    { label: 'Posted', value: formatDateTime(vars.publishedAt) },
  ];
  if (vars.expiresOn !== undefined) {
    rows.push({ label: 'Relevant until', value: formatDate(vars.expiresOn) });
  }

  return [
    heading(vars.title),
    ...paras(excerpt(vars.body)),
    details(rows),
    action('Read it in the app', PATHS.notice(vars.announcementId)),
    note('Notices stay in the app, so this is not the only copy.'),
  ];
}

export const subject = (vars: AnnouncementPublishedVars): string =>
  `${ANNOUNCEMENT_CATEGORY[vars.category].label}: ${vars.title}`;

export const text = (vars: AnnouncementPublishedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: AnnouncementPublishedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: AnnouncementPublishedVars): Record<string, string> => ({
  title: vars.title,
  category: ANNOUNCEMENT_CATEGORY[vars.category].label,
  postedBy: vars.authorName,
  publishedAt: formatDateTime(vars.publishedAt),
  ...(vars.expiresOn === undefined ? {} : { expiresOn: formatDate(vars.expiresOn) }),
});

export function decode(payload: unknown): AnnouncementPublishedVars {
  const raw = asObject(payload);
  const expiresOn = optDate(raw, 'expiresOn');
  return {
    announcementId: int(raw, 'announcementId'),
    title: str(raw, 'title', 140),
    body: str(raw, 'body', 5000),
    category: oneOf(raw, 'category', ANNOUNCEMENT_CATEGORIES),
    authorName: str(raw, 'authorName', 120),
    publishedAt: date(raw, 'publishedAt'),
    ...(expiresOn === undefined ? {} : { expiresOn }),
  };
}

export const template: MailTemplate<AnnouncementPublishedVars> = {
  id: 'announcement.published',
  decode,
  subject,
  text,
  html,
  variables,
};
