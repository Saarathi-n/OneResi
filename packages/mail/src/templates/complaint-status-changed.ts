import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY,
  COMPLAINT_STATUS,
  COMPLAINT_STATUSES,
} from '@oneresi/contracts';
import { action, details, note, para, quote, renderHtml, renderText } from '../document.js';
import { asObject, date, int, oneOf, optDate, str } from '../decode.js';
import { formatDate, formatDateTime } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * A complaint moved, and the resident who raised it is told what changed and by whom.
 *
 * `reopenableUntil` arrives already worked out. That is deliberate: the seven-day window is measured
 * from the resolution timestamp, which the previous build overwrote with null on every later update,
 * so the window silently disappeared (D-20). A template does no date arithmetic, so it cannot get
 * that boundary wrong.
 */

export interface ComplaintStatusChangedVars {
  readonly recipientName: string;
  readonly complaintId: number;
  readonly category: (typeof COMPLAINT_CATEGORIES)[number];
  readonly status: (typeof COMPLAINT_STATUSES)[number];
  readonly note: string;
  readonly updatedByName: string;
  readonly updatedAt: Date;
  /** Present when the resident can still reopen it. */
  readonly reopenableUntil?: Date;
}

export type ComplaintStatusChangedPayload = Wire<ComplaintStatusChangedVars>;

function compose(vars: ComplaintStatusChangedVars): Block[] {
  const category = COMPLAINT_CATEGORY[vars.category].label.toLowerCase();

  const blocks: Block[] = [
    para(`Hello ${vars.recipientName},`),
    para(`There is an update on the ${category} complaint you raised.`),
    details([
      { label: 'Now', value: COMPLAINT_STATUS[vars.status].label },
      { label: 'Updated by', value: vars.updatedByName },
      { label: 'When', value: formatDateTime(vars.updatedAt) },
    ]),
    quote(vars.note, vars.updatedByName),
    action('See the whole thread', PATHS.complaint(vars.complaintId)),
  ];

  if (vars.reopenableUntil !== undefined) {
    blocks.push(
      note(
        `If the problem comes back, you can reopen this until ${formatDate(vars.reopenableUntil)} ` +
          'and it goes straight back to the committee with everything that has been said so far.',
      ),
    );
  }

  return blocks;
}

export const subject = (vars: ComplaintStatusChangedVars): string =>
  `${COMPLAINT_CATEGORY[vars.category].label} complaint — ${COMPLAINT_STATUS[vars.status].label}`;

export const text = (vars: ComplaintStatusChangedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: ComplaintStatusChangedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: ComplaintStatusChangedVars): Record<string, string> => ({
  name: vars.recipientName,
  category: COMPLAINT_CATEGORY[vars.category].label,
  status: COMPLAINT_STATUS[vars.status].label,
  updatedBy: vars.updatedByName,
  updatedAt: formatDateTime(vars.updatedAt),
  ...(vars.reopenableUntil === undefined
    ? {}
    : { reopenableUntil: formatDate(vars.reopenableUntil) }),
});

export function decode(payload: unknown): ComplaintStatusChangedVars {
  const raw = asObject(payload);
  const reopenableUntil = optDate(raw, 'reopenableUntil');
  return {
    recipientName: str(raw, 'recipientName', 120),
    complaintId: int(raw, 'complaintId'),
    category: oneOf(raw, 'category', COMPLAINT_CATEGORIES),
    status: oneOf(raw, 'status', COMPLAINT_STATUSES),
    note: str(raw, 'note', 1000),
    updatedByName: str(raw, 'updatedByName', 120),
    updatedAt: date(raw, 'updatedAt'),
    ...(reopenableUntil === undefined ? {} : { reopenableUntil }),
  };
}

export const template: MailTemplate<ComplaintStatusChangedVars> = {
  id: 'complaint.updated',
  decode,
  subject,
  text,
  html,
  variables,
};
