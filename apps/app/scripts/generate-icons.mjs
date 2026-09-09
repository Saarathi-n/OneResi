/*
 * Generates the PWA icon set from the brand mark (packages/ui/src/brand/mark.ts) — the same
 * house-and-one path the app's Logo renders. Run once from the repo root:
 *
 *   node apps/app/scripts/generate-icons.mjs
 *
 * sharp is resolved explicitly from the pnpm store because it is not a dependency of this
 * package (and must not become one); the store path is the one the lockfile guarantees.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sharpPath = path.join(repoRoot, 'node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js');
const sharp = (await import(pathToFileURL(sharpPath).href)).default;

const HOUSE = 'M11.06 2.62Q12 1.82 12.94 2.62L21.44 9.86Q22 10.34 22 11.08V20.2Q22 22 20.2 22H3.8Q2 22 2 20.2V11.08Q2 10.34 2.56 9.86Z';
const NUMERAL = 'M8.42 9.95L10.7 8H13.3V19.2H10.7V11.02L9.91 11.7Z';

const outDir = path.join(repoRoot, 'apps/app/public/icons');
await mkdir(outDir, { recursive: true });

/**
 * The mark as a standalone SVG. `markScale`/`markOffset` place it: 1 means it fills the
 * viewBox edge to edge (the right look for a regular icon), smaller values keep the mark
 * inside the maskable safe zone (the central 80% circle where launchers may crop).
 */
function iconSvg({ size, markScale = 1 }) {
  const translate = (size * (1 - markScale)) / 2;
  const scaled = size * markScale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="#1d6853"/>` +
      `<g transform="translate(${translate} ${translate}) scale(${markScale})">` +
      `<g transform="translate(0 ${size * 0.02})">` +
      `<path d="${HOUSE}" fill="#ffffff" fill-rule="evenodd"/>` +
      `<path d="${NUMERAL}" fill="#1d6853"/>` +
      `</g></g>` +
      `</svg>`,
  );
}

const targets = [
  // src, purpose, mark scale
  { file: 'icon-192.png', size: 192, scale: 0.92 },
  { file: 'icon-512.png', size: 512, scale: 0.92 },
  // Maskable: the launcher crops to any shape within the safe zone, so the mark sits well
  // inside it and the ground fills the whole canvas.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.68 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.92 },
  { file: 'favicon-32.png', size: 32, scale: 1 },
];

for (const { file, size, scale } of targets) {
  const png = await sharp(iconSvg({ size, markScale: scale }))
    .resize(size, size, { fit: 'contain', background: { r: 0x1d, g: 0x68, b: 0x53 } })
    .png()
    .toBuffer();
  await writeFile(path.join(outDir, file), png);
  console.log(`${file} ${png.length} bytes`);
}
