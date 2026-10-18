import { startPythonSidecar, stopPythonSidecar } from '@/server/pythonSidecar';

test('starts the Python sidecar and lists strategies', async () => {
  try {
    const info = await startPythonSidecar();
    expect(info.online).toBe(true);
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(info.strategies).toContain('auction');
  } finally {
    await stopPythonSidecar();
  }
});
