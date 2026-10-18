import { startPythonSidecar } from '@/server/pythonSidecar';

test('starts the Python sidecar and lists strategies', async () => {
  const info = await startPythonSidecar();
  expect(info.online).toBe(true);
  expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(info.strategies).toContain('auction');
});
