import { ConfigError, defaultConfig, parseConfig } from '@/sim/config';

test('fills defaults for an empty object', () => {
  expect(parseConfig({})).toEqual(defaultConfig);
});

test('rejects a dock outside the grid', () => {
  expect(() =>
    parseConfig({
      grid: { width: 10, height: 10 },
      stations: [{ id: 'S-1', docks: [[10, 1]], queueCapacity: 4, serviceTimeMs: 1000 }],
    }),
  ).toThrow(ConfigError);
});

test('rejects duplicate dock cells across stations', () => {
  expect(() =>
    parseConfig({
      stations: [
        { id: 'S-1', docks: [[0, 1]], queueCapacity: 4, serviceTimeMs: 1000 },
        { id: 'S-2', docks: [[0, 1]], queueCapacity: 4, serviceTimeMs: 1000 },
      ],
    }),
  ).toThrow(ConfigError);
});

test('rejects more robots than grid cells', () => {
  expect(() =>
    parseConfig({
      grid: { width: 2, height: 2 },
      robots: 5,
      stations: [{ id: 'S-1', docks: [[0, 0]], queueCapacity: 1, serviceTimeMs: 1000 }],
    }),
  ).toThrow(ConfigError);
});
