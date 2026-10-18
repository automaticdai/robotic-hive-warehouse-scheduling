/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer } from 'node:http';
import { createAllocator, AllocatorError, pythonModuleName } from '@/lib/allocator';
import { PythonAllocator, AllocatorTimeoutError } from '@/lib/pythonAllocator';

function observation() {
  return { simTimeMs: 0, allocationSeq: 0, robots: [], jobs: [], stations: [] };
}

test('posts the observation and returns assignments', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/sessions') {
      res.end(JSON.stringify({ sessionId: 's1', strategy: 'auction' }));
      return;
    }
    res.end(JSON.stringify({ assignments: [{ jobId: 'J-1', robotId: 'R-1', stationId: 'S-1' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const allocator = new PythonAllocator({ baseUrl: `http://127.0.0.1:${port}`, strategy: 'auction', timeoutMs: 500 });
  await expect(allocator.allocate(observation() as any)).resolves.toEqual([
    { jobId: 'J-1', robotId: 'R-1', stationId: 'S-1' },
  ]);
  await allocator.dispose();
  server.close();
});

test('times out and raises AllocatorTimeoutError', async () => {
  const server = createServer(() => { /* never respond */ });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const allocator = new PythonAllocator({ baseUrl: `http://127.0.0.1:${port}`, strategy: 'auction', timeoutMs: 50 });
  await expect(allocator.allocate(observation() as any)).rejects.toBeInstanceOf(AllocatorTimeoutError);
  await allocator.dispose();
  server.closeAllConnections();
  server.close();
});

test('rejects python strategies without a sidecar URL', () => {
  expect(() => createAllocator('python:auction', { pythonUrl: null, timeoutMs: 100 })).toThrow(
    AllocatorError,
  );
});

test('creates exactly one session for concurrent allocations', async () => {
  let sessionCreations = 0;
  const assignments = [{ jobId: 'J-1', robotId: 'R-1', stationId: 'S-1' }];
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/sessions') {
      sessionCreations += 1;
      setTimeout(() => {
        res.end(JSON.stringify({ sessionId: 's1', strategy: 'auction' }));
      }, 50);
      return;
    }
    res.end(JSON.stringify({ assignments }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const allocator = new PythonAllocator({
    baseUrl: `http://127.0.0.1:${port}`,
    strategy: 'auction',
    timeoutMs: 500,
  });

  const [first, second] = await Promise.all([
    allocator.allocate(observation() as any),
    allocator.allocate(observation() as any),
  ]);

  expect(sessionCreations).toBe(1);
  expect(first).toEqual(assignments);
  expect(second).toEqual(assignments);

  await allocator.dispose();
  server.close();
});

test('extracts valid Python module names', () => {
  expect(pythonModuleName('python:auction')).toBe('auction');
  expect(pythonModuleName('python:fcfs_reference')).toBe('fcfs_reference');
  expect(pythonModuleName('python:nearest2robot')).toBe('nearest2robot');
});

test('rejects traversal, empty, and digits-first module names', () => {
  for (const strategy of [
    'python:',
    'python:../hive_sim/protocol',
    'python:1auction',
    'python:auction.py',
    'python:auction/evil',
    'python:auction\\evil',
    'builtin:fcfs',
    'auction',
  ]) {
    expect(() => pythonModuleName(strategy)).toThrow(AllocatorError);
  }
});

test('createAllocator rejects invalid python module names', () => {
  for (const strategy of [
    'python:',
    'python:../hive_sim/protocol',
    'python:1auction',
  ]) {
    expect(() =>
      createAllocator(strategy, { pythonUrl: 'http://127.0.0.1:1', timeoutMs: 100 }),
    ).toThrow(AllocatorError);
  }
});
