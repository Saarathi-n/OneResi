import { action, details, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, date, str } from '../decode.js';
import { formatDateTime } from '../format.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The reset link.
 *
 * Three things the previous build got wrong here, all of them in one route. The token came from
 * `Math.random()` (D-37); nothing was ever stored, so the link could not have worked (D-22); and the
 * URL was hardcoded to `http://localhost:3000`, so a deployed build emailed residents an address on
 * their own machine (D-22). The token now arrives already generated and already hashed into the
 * account row, and the link is built from `APP_ORIGIN` like every other link in this package.
 *
 * NOTE for whoever builds the committee's mail log: this is the one message whose rendered body is a
 * live credential until it expires or is used. Redact the body for this template, or do not render
 * bodies to anyone but the recipient.
 */

export interface PasswordResetVars {
  readonly recipientName: string;
  /** The single-use token. Only its hash is stored on the account. */
  readonly token: string;
  readonly expiresAt: Date;
}

export type PasswordResetPayload = Wire<PasswordResetVars>;

function compose(vars: PasswordResetVars): Block[] {
  return [
    heading('Reset your password'),
    para(`Hello ${vars.recipientName},`),
    para(
      'Someone asked to reset the password on this account. If that was you, choose a new one here.',
    ),
    action('Choose a new password', PATHS.resetPassword(vars.token)),
    details([{ label: 'Link expires', value: formatDateTime(vars.expiresAt) }]),
    note(
      'The link works once, and only until it expires. Setting a new password signs out anywhere ' +
        'you are already signed in. If you did not ask for this, you can ignore this message — ' +
        'nothing changes until the link is used.',
    ),
  ];
}

export const subject = (): string => 'Reset your GrihaOne password';

export const text = (vars: PasswordResetVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: PasswordResetVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

/** The token is deliberately absent: it is a password equivalent and this column is queryable. */
export const variables = (vars: PasswordResetVars): Record<string, string> => ({
  name: vars.recipientName,
  expiresAt: formatDateTime(vars.expiresAt),
});

export function decode(payload: unknown): PasswordResetVars {
  const raw = asObject(payload);
  return {
    recipientName: str(raw, 'recipientName', 120),
    token: str(raw, 'token', 200),
    expiresAt: date(raw, 'expiresAt'),
  };
}

export const template: MailTemplate<PasswordResetVars> = {
  id: 'password.reset_requested',
  decode,
  subject,
  text,
  html,
  variables,
};
