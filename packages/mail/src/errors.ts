/**
 * Failure kinds, separated because the worker has to decide between "try this again later" and
 * "never try this again".
 *
 * The previous build wrapped an inline send in one try/catch and swallowed whatever came out, so a
 * misconfigured provider and a malformed message looked identical, and both looked like success
 * (D-30). Here the distinction is a type:
 *
 *   - `PayloadError` / `RenderError`  the message itself is wrong. Retrying cannot help; the row is
 *                                    abandoned with the reason, which is visible in the mail log.
 *   - `MailConfigError`              an operator fixes it (an unset origin, an unverified sender).
 *                                    Transient by definition, so the row keeps its attempts.
 *   - `MailDeliveryError`            the provider spoke. It says whether it is permanent.
 */

export class MailConfigError extends Error {
  override readonly name = 'MailConfigError';
}

/** The JSON in `OutboxEvent.payload` is not what the template needs. */
export class PayloadError extends Error {
  override readonly name = 'PayloadError';
}

/** A template produced something that must never be delivered. See `assertRenderSafe`. */
export class RenderError extends Error {
  override readonly name = 'RenderError';
}

export interface MailDeliveryErrorOptions extends ErrorOptions {
  /** True when a retry cannot possibly succeed — a rejected address, a suppressed recipient. */
  readonly permanent?: boolean;
  /** The provider's own error name, recorded so a pattern is visible across rows. */
  readonly providerCode?: string;
}

export class MailDeliveryError extends Error {
  override readonly name = 'MailDeliveryError';
  readonly permanent: boolean;
  readonly providerCode: string | undefined;

  constructor(message: string, options: MailDeliveryErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.permanent = options.permanent ?? false;
    this.providerCode = options.providerCode;
  }
}

/** Thrown by `expectMail()`. Carries its own diagnostics; no test framework is imported. */
export class MailAssertionError extends Error {
  override readonly name = 'MailAssertionError';
}

/** A message the mail worker must not attempt again. */
export function isPermanent(error: unknown): boolean {
  if (error instanceof PayloadError || error instanceof RenderError) return true;
  if (error instanceof MailDeliveryError) return error.permanent;
  return false;
}

const MAX_RECORDED_ERROR = 900;

/**
 * A non-Error value can still carry something readable: a plain string is itself, an object with a
 * `message` is almost always a wrapped Error from another boundary, and anything else is shown as
 * its JSON rather than `[object Object]` — which is what `String()` writes and what the row used to
 * record when a provider rejected with a plain object.
 */
function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { readonly message: unknown }).message;
    if (typeof message === 'string' && message !== '') return message;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or a getter that throws — the row still gets one honest line.
    return String(value);
  }
}

/**
 * What goes in `OutboxEvent.lastError` and `MailMessage.error`: one readable line, bounded, with
 * the cause chain flattened. Never a stack — the row is read by a person in the mail log.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else {
      parts.push(describeUnknown(current));
      break;
    }
  }

  const line = parts.join(' <- ').replace(/\s+/g, ' ').trim();
  return line.length > MAX_RECORDED_ERROR ? `${line.slice(0, MAX_RECORDED_ERROR - 1)}…` : line;
}
