import { getSimConfigResponse, getConfigsResponse } from '@/server/discovery';

test('sim-config always includes builtin:fcfs', async () => {
  const response = await getSimConfigResponse();
  expect(response.strategies).toContain('builtin:fcfs');
});

test('config list contains smoke.json', async () => {
  expect((await getConfigsResponse()).map((c) => c.name)).toContain('smoke');
});
