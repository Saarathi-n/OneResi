import { action, details, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, date, optStr, str } from '../decode.js';
import { formatTime } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, DetailRow, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * Someone is standing at the gate and a guard is waiting for an answer.
 *
 * The urgent one. It exists because a resident with the app already open never saw the visitor at all
 * in the previous build — the pending list was fetched once on mount and never again (D-68). Mail is
 * the slowest of the three surfaces this event feeds; the in-app stream and the push notification
 * come from the same outbox row.
 */

export interface VisitorWaitingVars {
  readonly recipientName: string;
  readonly visitorName: string;
  readonly purpose: string;
  readonly visitorPhone?: string;
  readonly arrivedAt: Date;
}

export type VisitorWaitingPayload = Wire<VisitorWaitingVars>;

function compose(vars: VisitorWaitingVars): Block[] {
  const rows: DetailRow[] = [
    { label: 'Visitor', value: vars.visitorName },
    { label: 'Purpose', value: vars.purpose },
  ];
  if (vars.visitorPhone !== undefined) {
    rows.push({ label: 'Phone', value: vars.visitorPhone });
  }
  rows.push({ label: 'At the gate since', value: formatTime(vars.arrivedAt) });

  return [
    heading(`${vars.visitorName} is at the gate`),
    para(
      `Hello ${vars.recipientName}, the guard is waiting for you to say whether to let them in.`,
    ),
    details(rows),
    action('Let them in or turn them away', PATHS.waitingVisitors),
    note(
      'The guard sees your answer immediately. If nobody answers, they follow the standing ' +
        'instructions for the society.',
    ),
  ];
}

export const subject = (vars: VisitorWaitingVars): string => `${vars.visitorName} is at the gate`;

export const text = (vars: VisitorWaitingVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: VisitorWaitingVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: VisitorWaitingVars): Record<string, string> => ({
  name: vars.recipientName,
  visitor: vars.visitorName,
  purpose: vars.purpose,
  arrivedAt: formatTime(vars.arrivedAt),
  ...(vars.visitorPhone === undefined ? {} : { phone: vars.visitorPhone }),
});

export function decode(payload: unknown): VisitorWaitingVars {
  const raw = asObject(payload);
  const visitorPhone = optStr(raw, 'visitorPhone', 20);
  return {
    recipientName: str(raw, 'recipientName', 120),
    visitorName: str(raw, 'visitorName', 120),
    purpose: str(raw, 'purpose', 120),
    arrivedAt: date(raw, 'arrivedAt'),
    ...(visitorPhone === undefined ? {} : { visitorPhone }),
  };
}

export const template: MailTemplate<VisitorWaitingVars> = {
  id: 'walkin.awaiting_decision',
  decode,
  subject,
  text,
  html,
  variables,
};
