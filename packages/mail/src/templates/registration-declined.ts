import { heading, note, para, quote, renderHtml, renderText } from '../document.js';
import { asObject, optStr, str } from '../decode.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The application was declined. Nobody enjoys this message, so it is short, it says what happens
 * next, and it does not hide behind a status word.
 *
 * Declining must also leave the unit unoccupied — a resident rejected after approval left the unit
 * marked occupied and it was billed every month afterwards (D-42). That is the domain's job; this
 * template exists so the applicant is actually told.
 */

export interface RegistrationDeclinedVars {
  readonly recipientName: string;
  readonly home: string;
  /** The committee's reason, when they gave one. */
  readonly reason?: string;
}

export type RegistrationDeclinedPayload = Wire<RegistrationDeclinedVars>;

function compose(vars: RegistrationDeclinedVars): Block[] {
  const blocks: Block[] = [
    heading('About your application'),
    para(`Hello ${vars.recipientName},`),
    para(
      `The committee has looked at your application for ${vars.home} and has not been able to ` +
        'approve it.',
    ),
  ];

  if (vars.reason !== undefined) {
    blocks.push(para('The reason they gave:'), quote(vars.reason));
  }

  blocks.push(
    para(
      'If something in the details was wrong, or your circumstances have changed, the committee at ' +
        'the society office can look at it again, and you are welcome to apply once more.',
    ),
    note('No account has been created, and nothing has been charged.'),
  );

  return blocks;
}

export const subject = (): string => 'About your OneResi application';

export const text = (vars: RegistrationDeclinedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: RegistrationDeclinedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: RegistrationDeclinedVars): Record<string, string> => ({
  name: vars.recipientName,
  home: vars.home,
  ...(vars.reason === undefined ? {} : { reason: vars.reason }),
});

export function decode(payload: unknown): RegistrationDeclinedVars {
  const raw = asObject(payload);
  const reason = optStr(raw, 'reason', 280);
  return {
    recipientName: str(raw, 'recipientName', 120),
    home: str(raw, 'home', 120),
    ...(reason === undefined ? {} : { reason }),
  };
}

export const template: MailTemplate<RegistrationDeclinedVars> = {
  id: 'resident.declined',
  decode,
  subject,
  text,
  html,
  variables,
};
