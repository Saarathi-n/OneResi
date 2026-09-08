/**
 * Time, injectable. Services never call `Date.now()` — every timestamp they emit or judge comes
 * from a clock handed to them, so a test ages a token or expires a link by moving one hand
 * instead of faking the global timer.
 */
export interface Clock {
  now(): Date;
}
