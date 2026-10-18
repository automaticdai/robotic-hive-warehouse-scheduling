import { FcfsAllocator } from '@/sim/fcfs';
import type { AllocationObservation } from '@/sim/allocation';

const observation: AllocationObservation = {
  simTimeMs: 10_000,
  allocationSeq: 1,
  robots: [
    { id: 'R-0001', cell: { x: 0, y: 0 }, status: 'idle', battery: 1, jobId: null },
    { id: 'R-0002', cell: { x: 9, y: 0 }, status: 'idle', battery: 1, jobId: null },
  ],
  jobs: [
    { id: 'J-2', orderId: 'O-2', podId: 'P-2', pickup: { x: 5, y: 0 },
      candidateStations: ['S-1', 'S-2'], priority: 2, createdAtMs: 9000,
      dependsOn: [] },
    { id: 'J-1', orderId: 'O-1', podId: 'P-1', pickup: { x: 5, y: 0 },
      candidateStations: ['S-1', 'S-2'], priority: 1, createdAtMs: 8000,
      dependsOn: [] },
  ],
  stations: [
    { id: 'S-1', queueLength: 3, queueCapacity: 8, serviceTimeMs: 1000, busy: true },
    { id: 'S-2', queueLength: 0, queueCapacity: 8, serviceTimeMs: 1000, busy: false },
  ],
};

test('assigns oldest job to nearest robot and least-penalised station', () => {
  const result = new FcfsAllocator().allocate(observation);
  expect(result[0]).toEqual({ jobId: 'J-1', robotId: 'R-0002', stationId: 'S-2' });
});
