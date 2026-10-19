import type { Snapshot } from '@/sim/simulation';

export interface StationLabelsProps {
  snapshot: Snapshot | null;
}

/**
 * Station plates over the hive view: id, queue gauge and queue count. They
 * start hidden at the stage origin; the scene's `StationMeshes` moves each
 * one onto its station block every frame.
 */
export function StationLabels({ snapshot }: StationLabelsProps) {
  return (
    <div className="station-labels" aria-hidden="true">
      {(snapshot?.stations ?? []).map((station) => {
        const ratio = station.capacity > 0 ? station.queueLength / station.capacity : 0;
        return (
          <div key={station.id} className="station-label" data-station-label={station.id}>
            <span className="station-label-id">{station.id}</span>
            <span className="station-label-gauge">
              <span
                className="station-label-fill"
                data-full={ratio >= 1 ? 'true' : 'false'}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="station-label-count">
              {station.queueLength}/{station.capacity}
            </span>
          </div>
        );
      })}
    </div>
  );
}
