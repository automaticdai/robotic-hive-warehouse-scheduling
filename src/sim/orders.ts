import type { OrdersConfig } from './config';
import type { Rng } from './rng';
import type { Job, Order, Pod, World } from './types';

/**
 * Synthetic order generator. Arrivals follow a Poisson process sampled from the
 * seeded RNG; every due order expands into one independent ready trip job per
 * line, each reserving a distinct available pod.
 */
export class OrderGenerator {
  private readonly world: World;
  private readonly config: OrdersConfig;
  private readonly rng: Rng;
  private nextArrivalMs: number;

  constructor(world: World, config: OrdersConfig, rng: Rng) {
    this.world = world;
    this.config = config;
    this.rng = rng;
    this.nextArrivalMs =
      config.arrivalRatePerHour === 0
        ? Number.POSITIVE_INFINITY
        : world.simTimeMs + this.exponentialInterarrival();
  }

  generateDueOrders(): Order[] {
    const created: Order[] = [];
    if (!Number.isFinite(this.nextArrivalMs)) {
      return created;
    }

    while (this.nextArrivalMs <= this.world.simTimeMs) {
      const arrivalMs = this.nextArrivalMs;
      this.nextArrivalMs += this.exponentialInterarrival();

      const { min, max } = this.config.linesPerOrder;
      const desiredLines = min + this.rng.int(max - min + 1);

      // Snapshot the free pods once per arrival. Selections below reserve pods
      // immediately, so later arrivals in this batch see the updated flags.
      const candidates = this.world.pods.filter(
        (pod) => pod.available && pod.reservedByJobId === null,
      );
      if (candidates.length === 0) {
        continue;
      }

      const lineCount = Math.min(desiredLines, candidates.length);
      const selected: Pod[] = [];
      for (let line = 0; line < lineCount; line++) {
        const index = this.rng.int(candidates.length);
        selected.push(candidates[index]!);
        candidates[index] = candidates[candidates.length - 1]!;
        candidates.pop();
      }

      const orderId = `O-${String(this.world.orders.size + 1).padStart(6, '0')}`;
      const candidateStations = this.world.stations.map((station) => station.id);
      const jobIds: string[] = [];

      for (const pod of selected) {
        const jobId = `J-${String(this.world.jobs.size + 1).padStart(7, '0')}`;
        const job: Job = {
          id: jobId,
          orderId,
          podId: pod.id,
          pickup: { x: pod.cell.x, y: pod.cell.y },
          candidateStations: [...candidateStations],
          dependsOn: [],
          priority: 0,
          createdAtMs: arrivalMs,
          status: 'ready',
          stationId: null,
          robotId: null,
          completedAtMs: null,
        };
        pod.reservedByJobId = jobId;
        this.world.jobs.set(jobId, job);
        jobIds.push(jobId);
      }

      const order: Order = {
        id: orderId,
        createdAtMs: arrivalMs,
        jobIds,
        stationId: null,
        podsTotal: lineCount,
        podsServiced: 0,
        packingRemainingMs: null,
        completedAtMs: null,
      };
      this.world.orders.set(orderId, order);
      created.push(order);
    }

    return created;
  }

  /** Exponential interarrival in ms for the configured hourly rate. */
  private exponentialInterarrival(): number {
    const rate = this.config.arrivalRatePerHour;
    if (rate === 0) {
      return Number.POSITIVE_INFINITY;
    }
    return -Math.log(1 - this.rng.next()) * (3_600_000 / rate);
  }
}
