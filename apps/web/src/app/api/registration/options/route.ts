import { services } from '@/server/runtime';
import { toResponse } from '@/server/http';

/** The only public property surface: block and unit labels for registration. No charges. */
export async function GET() {
  const { property } = await services();
  return toResponse(await property.registrationOptions());
}
