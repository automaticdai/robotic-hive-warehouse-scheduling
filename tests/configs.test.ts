import { readdirSync, readFileSync } from 'node:fs';
import { parseConfig } from '@/sim/config';

test('every config parses and the default matches the spec targets', () => {
  const files = readdirSync('configs').filter((f) => f.endsWith('.json'));
  expect(files).toContain('default.json');
  for (const file of files) {
    expect(() => parseConfig(JSON.parse(readFileSync(`configs/${file}`, 'utf8')))).not.toThrow();
  }
  const config = parseConfig(JSON.parse(readFileSync('configs/default.json', 'utf8')));
  expect(config.grid).toEqual({ width: 100, height: 100 });
  expect(config.robots).toBe(2000);
  expect(config.pods.count).toBe(6000);
});
