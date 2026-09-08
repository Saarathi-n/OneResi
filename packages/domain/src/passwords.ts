/**
 * A small wall around the bcrypt library (the seeded round count stays where ADR 0001 put it,
 * and domain stays importable pure). The db package installs the adapter; tests install a
 * cheaper one. Cost is whatever `BCRYPT_COST` says — never a literal, and never 10 (D-43).
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}
