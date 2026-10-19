import { getSimConfigResponse } from '@/server/discovery';
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

test('sim-config revalidates the sidecar instead of serving a stale cache', async () => {
  try {
    await startPythonSidecar();

    const online = await getSimConfigResponse();
    expect(online.sidecar.online).toBe(true);
    expect(online.sidecar.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(online.strategies).toContain('python:auction');

    // Simulate the sidecar becoming unreachable. The next request must probe
    // rather than echo the cached online state.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connection refused');
    }));
    const offline = await getSimConfigResponse();
    expect(offline.sidecar.online).toBe(false);
    expect(offline.sidecar.url).toBeNull();
    expect(offline.strategies).toEqual(['builtin:fcfs']);

    // And recovery is visible without a page reload.
    vi.unstubAllGlobals();
    const recovered = await getSimConfigResponse();
    expect(recovered.sidecar.online).toBe(true);
    expect(recovered.strategies).toContain('python:auction');
  } finally {
    vi.unstubAllGlobals();
    await stopPythonSidecar();
  }
});
