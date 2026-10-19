import { FLOOR_PALETTE } from '@/components/hive/render';

const ENTRIES = [
  { label: 'Pod in storage', className: 'key-pod', color: FLOOR_PALETTE.podStored },
  { label: 'Pod reserved for a trip', className: 'key-pod', color: FLOOR_PALETTE.podReserved },
  { label: 'Empty slot (pod at a station)', className: 'key-slot', color: FLOOR_PALETTE.storage },
  { label: 'Port zone, kept clear of pods', className: 'key-hatch', color: FLOOR_PALETTE.safety },
  { label: 'Dock cell', className: 'key-dock', color: FLOOR_PALETTE.dock },
];

/** Legend for the floor markings drawn under the robots. */
export function FloorKey() {
  return (
    <ul className="floor-key" aria-label="Floor key">
      {ENTRIES.map((entry) => (
        <li key={entry.label}>
          <span className={`key-mark ${entry.className}`} style={{ backgroundColor: entry.color }} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
