import { APPROVAL_STATUS } from '@oneresi/contracts';
import { action, details, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, date, oneOf, str } from '../decode.js';
import { formatDateTime } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The decision on a walk-in, written down.
 *
 * Both facts in it — who decided and when — are columns the previous build never wrote, so there was
 * no record of which resident admitted a visitor, which for a gate audit log is the one fact worth
 * having (D-21). The decision renders through the label map from `@oneresi/contracts`, never as the
 * raw value (D-55).
 */

/** The two decisions a resident can make. A subset of `APPROVAL_STATUSES`. */
export const DECISIONS = ['APPROVED', 'REJECTED'] as const;

export interface VisitorDecidedVars {
  readonly visitorName: string;
  readonly purpose: string;
  readonly decision: (typeof DECISIONS)[number];
  readonly decidedByName: string;
  readonly decidedAt: Date;
  /** Which home the visitor came for — "Block A · A-101". */
  readonly home: string;
}

export type VisitorDecidedPayload = Wire<VisitorDecidedVars>;

function compose(vars: VisitorDecidedVars): Block[] {
  return [
    heading('Gate decision recorded'),
    para(
      `${vars.decidedByName} answered for ${vars.home}. The gate has been told and the visit is in ` +
        'the log.',
    ),
    details([
      { label: 'Visitor', value: vars.visitorName },
      { label: 'Purpose', value: vars.purpose },
      { label: 'Decision', value: APPROVAL_STATUS[vars.decision].label },
      { label: 'Answered by', value: vars.decidedByName },
      { label: 'At', value: formatDateTime(vars.decidedAt) },
    ]),
    action('See the gate log', PATHS.gateLog),
    note('Every entry and exit is recorded against the home it was for.'),
  ];
}

export const subject = (vars: VisitorDecidedVars): string =>
  `Gate decision for ${vars.visitorName}: ${APPROVAL_STATUS[vars.decision].label}`;

export const text = (vars: VisitorDecidedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: VisitorDecidedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: VisitorDecidedVars): Record<string, string> => ({
  visitor: vars.visitorName,
  purpose: vars.purpose,
  decision: APPROVAL_STATUS[vars.decision].label,
  decidedBy: vars.decidedByName,
  decidedAt: formatDateTime(vars.decidedAt),
  home: vars.home,
});

export function decode(payload: unknown): VisitorDecidedVars {
  const raw = asObject(payload);
  return {
    visitorName: str(raw, 'visitorName', 120),
    purpose: str(raw, 'purpose', 120),
    decision: oneOf(raw, 'decision', DECISIONS),
    decidedByName: str(raw, 'decidedByName', 120),
    decidedAt: date(raw, 'decidedAt'),
    home: str(raw, 'home', 120),
  };
}

export const template: MailTemplate<VisitorDecidedVars> = {
  id: 'walkin.decided',
  decode,
  subject,
  text,
  html,
  variables,
};
