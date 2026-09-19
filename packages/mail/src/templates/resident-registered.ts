import { action, details, heading, note, para, quote, renderHtml, renderText } from '../document.js';
import { asObject, date, emailAddress, int, optStr, str } from '../decode.js';
import { formatDateTime } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * A resident has applied and the committee has to decide. One message per committee member, written
 * by the handler as one outbox row each — never one message addressed to a list.
 */

export interface ResidentRegisteredVars {
  readonly applicantId: number;
  readonly applicantName: string;
  readonly applicantEmail: string;
  readonly applicantPhone: string;
  /** How the applicant's home reads — "Block A · A-101", or the claim they typed. */
  readonly home: string;
  /** Their own note, when the unit was not on the list and they described it. */
  readonly claimNote?: string;
  readonly submittedAt: Date;
}

export type ResidentRegisteredPayload = Wire<ResidentRegisteredVars>;

function compose(vars: ResidentRegisteredVars): Block[] {
  const blocks: Block[] = [
    heading(`New application for ${vars.home}`),
    para(`${vars.applicantName} has applied for an account and is waiting on the committee.`),
    details([
      { label: 'Name', value: vars.applicantName },
      { label: 'Home', value: vars.home },
      { label: 'Email', value: vars.applicantEmail },
      { label: 'Phone', value: vars.applicantPhone },
      { label: 'Applied', value: formatDateTime(vars.submittedAt) },
    ]),
  ];

  if (vars.claimNote !== undefined) {
    blocks.push(
      para('They could not find their unit on the list and described it instead:'),
      quote(vars.claimNote, vars.applicantName),
    );
  }

  blocks.push(
    action('Review the application', PATHS.registrationReview),
    note(
      'Approving creates their account and tells them they can sign in. Declining tells them too, ' +
        'with your reason if you give one.',
    ),
  );

  return blocks;
}

export const subject = (vars: ResidentRegisteredVars): string =>
  `New resident application — ${vars.home}`;

export const text = (vars: ResidentRegisteredVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: ResidentRegisteredVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: ResidentRegisteredVars): Record<string, string> => ({
  name: vars.applicantName,
  home: vars.home,
  email: vars.applicantEmail,
  phone: vars.applicantPhone,
  submittedAt: formatDateTime(vars.submittedAt),
});

export function decode(payload: unknown): ResidentRegisteredVars {
  const raw = asObject(payload);
  const claimNote = optStr(raw, 'claimNote', 280);
  return {
    applicantId: int(raw, 'applicantId'),
    applicantName: str(raw, 'applicantName', 120),
    applicantEmail: emailAddress(raw, 'applicantEmail'),
    applicantPhone: str(raw, 'applicantPhone', 20),
    home: str(raw, 'home', 120),
    submittedAt: date(raw, 'submittedAt'),
    ...(claimNote === undefined ? {} : { claimNote }),
  };
}

export const template: MailTemplate<ResidentRegisteredVars> = {
  id: 'resident.registered',
  decode,
  subject,
  text,
  html,
  variables,
};
