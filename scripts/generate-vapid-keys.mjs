#!/usr/bin/env node
/**
 * Generates the VAPID keypair web push signs with: `pnpm push:keys`.
 *
 * VAPID is how the push service knows the server that is talking to it — the public half is what
 * a browser's subscription encrypts TO and what the key route hands out, the private half never
 * leaves the server, and the subject is the mailto: contact the push service reaches the sender
 * on about deliverability. One keypair, generated once, kept forever: a rotated keypair orphans
 * every browser's subscription, which is exactly what this script exists to make a deliberate,
 * printed-in-advance choice rather than an accident (the same argument `vapidSettings` in
 * packages/mail/src/env.ts keeps for refusing half-set variables).
 *
 * A command-line tool; its interface is this console output. `web-push` is a dependency of
 * packages/mail (never the root), so it is reached through a require anchored there rather than
 * an import this file has no right to resolve.
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/mail/package.json', import.meta.url));
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('A VAPID keypair for web push. Generate once, keep forever.');
console.log('');
console.log('Set these three in the environment the web app runs with:');
console.log('');
console.log(`  VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`  VAPID_PRIVATE_KEY=${privateKey}`);
console.log('  VAPID_SUBJECT=mailto:you@yourdomain.in');
console.log('');
console.log('Where each value goes:');
console.log('  VAPID_PUBLIC_KEY   the key route hands it to browsers; also set in Terraform.');
console.log('  VAPID_PRIVATE_KEY  signs every send; a sensitive Terraform variable, never a file');
console.log('                     in the repository.');
console.log('  VAPID_SUBJECT      a mailto: contact address — the push service complains to it.');
console.log('');
console.log('Local development needs only PUSH_DRIVER left unset or "console" — no keys, no');
console.log('sends, and the enable-push control stays hidden. Setting PUSH_DRIVER=webpush without');
console.log('these three values refuses to boot in production.');
