/**
 * `@oneresi/mail` — templates, a renderer, two providers, and the outbox worker.
 *
 * How it fits together (docs/plan/02-architecture.md):
 *
 * ```
 * domain service ──tx──> [ state change + one outbox_event row per recipient ] ──> respond
 *                                        │
 *                                  drainOutbox()
 *                                        │
 *                          renderById ──> deliver ──> console | SES
 *                                        │
 *                                  mail_message row ──> expectMail() in a test,
 *                                                       the mail log for a person
 * ```
 *
 * `./testing` is deliberately a separate entry point, so the matcher and the test doubles never end up
 * in an application bundle. The two AWS-specific modules are separate too — `./providers/ses` and
 * `./providers/ses-events` — so importing `@oneresi/mail` in a local console-mode run pulls in no AWS
 * SDK at all; `selectProvider()` loads the SES one on demand.
 */

export * from './types.js';
export * from './errors.js';
export * from './env.js';
export * from './links.js';
export * from './format.js';
export * from './document.js';
export * from './payload.js';
export * from './render.js';
export * from './templates/index.js';
export * from './providers/index.js';
export * from './worker.js';
