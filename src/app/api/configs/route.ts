import { getConfigsResponse } from '@/server/discovery';

export async function GET(): Promise<Response> {
  return Response.json(await getConfigsResponse());
}
