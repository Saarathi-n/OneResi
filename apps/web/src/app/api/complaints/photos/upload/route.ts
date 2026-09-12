import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ACCEPTED_PHOTO_TYPES, photoVerdict } from '@grihaone/contracts';
import { actor, toResponse } from '@/server/http';

/**
 * One complaint photo, uploaded by the household that raised it (UC-06 step 3–4).
 *
 * The key convention is the S3 object key the model always stored: `uploads/complaints/<uuid>.<ext>`.
 * Locally the bytes land under `.data/uploads/` at the same key path — the same convention, a
 * different disk — and on AWS this route is replaced by a presigned PUT straight to the bucket,
 * which is why the route answers with the key and never a local path. A complaint's `photoKeys`
 * column carries keys either way, and the schema's validation (at most three, each 1–200 chars)
 * is the contract both deployments share.
 *
 * Validation per UC-06 step 4, before the first byte is stored: image types only (JPEG, PNG,
 * WebP — what every phone camera produces and every browser opens), and MAX_PHOTO_BYTES is the
 * ceiling. A file past either limit is refused with the reason; the rest of the form keeps
 * whatever it already uploaded.
 */

/** Where local uploads live — the same key namespace the S3 bucket uses in production. */
const UPLOAD_ROOT = join(process.cwd(), '.data', 'uploads');

export async function POST(request: NextRequest) {
  const who = await actor(request);
  if (!who.ok) return toResponse(who);
  if (who.value.role !== 'R') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Only a household can attach photos to its complaints.' },
      { status: 403 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('photo');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { code: 'INVALID_INPUT', message: 'Choose a photo to attach.', fields: ['photo'] },
      { status: 400 },
    );
  }

  // The one rule, stated once in @grihaone/contracts so the form and the tests read the same
  // verdict the route does (UC-06 step 4). The count arrives with the upload so a fourth photo
  // is refused here, not at the submit the photos precede.
  const already = Number(form?.get('already') ?? '0');
  const verdict = photoVerdict({
    type: file.type,
    sizeBytes: file.size,
    alreadyAttached: Number.isInteger(already) ? already : 0,
  });
  if (verdict !== null) {
    return NextResponse.json(
      {
        code: verdict.message.startsWith('Photos have') ? 'INVALID_INPUT' : 'LIMIT_REACHED',
        message: verdict.message,
        fields: ['photo'],
      },
      { status: verdict.message.startsWith('Photos have') ? 400 : 409 },
    );
  }
  const extension = ACCEPTED_PHOTO_TYPES[file.type];

  const key = `uploads/complaints/${randomUUID()}.${extension}`;
  const directory = join(UPLOAD_ROOT, 'complaints');
  await mkdir(directory, { recursive: true });
  await writeFile(join(UPLOAD_ROOT, key.replace('uploads/', '')), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ key, sizeBytes: file.size }, { status: 200 });
}
