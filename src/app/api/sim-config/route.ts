import { connection } from 'next/server';
import { getSimConfigResponse } from '@/server/discovery';

export async function GET(): Promise<Response> {
  // The response reflects the live sidecar process and module-global cache,
  // so it must be evaluated per request rather than captured at build time.
  await connection();
  return Response.json(await getSimConfigResponse());
}
