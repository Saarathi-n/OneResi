import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PHOTO_KEY_SHAPE } from '@grihaone/contracts';
import { actor, toResponse } from '@/server/http';

/**
 * Serves one complaint photo from the local store. The key is the same namespace the upload
 * route writes and the S3 bucket would hold in production — `uploads/complaints/<uuid>.<ext>` —
 * and the shape is checked before anything is read, so a path traversal attempt is an
 * INVALID_INPUT rather than a file it can name.
 */

const UPLOAD_ROOT = join(process.cwd(), '.data', 'uploads');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);

  const key = request.nextUrl.searchParams.get('key') ?? '';
  if (!PHOTO_KEY_SHAPE.test(key)) {
    return NextResponse.json(
      { code: 'INVALID_INPUT', message: 'That is not a photo key.', fields: ['key'] },
      { status: 400 },
    );
  }

  try {
    const bytes = await readFile(join(UPLOAD_ROOT, key.replace('uploads/', '')));
    const extension = key.split('.').pop() ?? 'jpg';
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'cache-control': 'private, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: 'That photo is no longer there.' },
      { status: 404 },
    );
  }
}
