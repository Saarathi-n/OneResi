import { action, bullets, heading, note, para, renderHtml, renderText } from '../document.js';
import { asObject, str } from '../decode.js';
import { PATHS } from '../links.js';
import type { Block, MailTemplate, RenderContext, Wire } from '../types.js';

/**
 * The committee approved the application. This is the first thing a resident reads from the system,
 * so it says what they can now do rather than announcing a status value.
 */

export interface RegistrationApprovedVars {
  readonly recipientName: string;
  /** "Block A · A-101". */
  readonly home: string;
}

export type RegistrationApprovedPayload = Wire<RegistrationApprovedVars>;

function compose(vars: RegistrationApprovedVars): Block[] {
  return [
    heading('Your account is ready'),
    para(`Hello ${vars.recipientName},`),
    para(
      `The committee has approved your account for ${vars.home}. You can sign in with this email ` +
        'address and the password you chose when you applied.',
    ),
    bullets([
      'Tell the gate about a visitor before they arrive, and get a code they can quote',
      'See what you owe, pay it, and keep the receipt',
      'Report something that is broken and follow it until it is fixed',
      'Book a facility for an evening',
      'Read what the committee posts',
    ]),
    action('Sign in', PATHS.signIn),
    note(
      'Install the app from your browser and it behaves like any other app on your phone, including ' +
        'a notification when someone is waiting at the gate for you.',
    ),
  ];
}

export const subject = (): string => 'Your OneResi account is ready';

export const text = (vars: RegistrationApprovedVars, context: RenderContext): string =>
  renderText(compose(vars), context);

export const html = (vars: RegistrationApprovedVars, context: RenderContext): string =>
  renderHtml(compose(vars), context);

export const variables = (vars: RegistrationApprovedVars): Record<string, string> => ({
  name: vars.recipientName,
  home: vars.home,
});

export function decode(payload: unknown): RegistrationApprovedVars {
  const raw = asObject(payload);
  return {
    recipientName: str(raw, 'recipientName', 120),
    home: str(raw, 'home', 120),
  };
}

export const template: MailTemplate<RegistrationApprovedVars> = {
  id: 'resident.approved',
  decode,
  subject,
  text,
  html,
  variables,
};
