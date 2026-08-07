import { useState } from 'react';
import {
  createProject,
  formatLength,
  parseLength,
  type BuildingType,
  type FloorSpec,
  type Project,
  type RegulatoryAuthority,
  type RoomSpec,
  type RoomUse,
} from '@adp/core';

interface Props {
  readonly project: Project | null;
  readonly onCreated: (project: Project) => void;
}

interface RoomDraft {
  readonly id: number;
  name: string;
  use: RoomUse;
  width: string;
  depth: string;
}

const USES: readonly RoomUse[] = [
  'reception',
  'office',
  'open_office',
  'executive_office',
  'conference',
  'meeting',
  'laboratory',
  'server_room',
  'training',
  'lounge',
  'corridor',
  'toilet',
  'store',
  'retail',
];

const BUILDING_TYPES: readonly BuildingType[] = [
  'commercial_plaza',
  'office',
  'residential_house',
  'apartment',
  'retail',
  'hospitality',
  'healthcare',
  'education',
  'industrial',
  'mixed_use',
];

let nextId = 1;

function draft(name: string, use: RoomUse, width: string, depth: string): RoomDraft {
  return { id: nextId++, name, use, width, depth };
}

export function SetupView({ project, onCreated }: Props): JSX.Element {
  const [name, setName] = useState('Islamabad Plaza');
  const [buildingType, setBuildingType] = useState<BuildingType>('commercial_plaza');
  const [city, setCity] = useState('Islamabad');
  const [floorCount, setFloorCount] = useState(1);
  const [clearHeight, setClearHeight] = useState("12'");
  const [rooms, setRooms] = useState<RoomDraft[]>([
    draft('Reception', 'reception', "24'", "30'"),
    draft('Open office', 'open_office', "40'", "30'"),
    draft('Conference room', 'conference', "20'", "24'"),
  ]);
  const [error, setError] = useState('');

  const authority: RegulatoryAuthority =
    city.trim().toLowerCase() === 'islamabad'
      ? 'CDA'
      : city.trim().toLowerCase() === 'rawalpindi'
        ? 'RDA'
        : 'OTHER_PK';

  const update = (id: number, patch: Partial<RoomDraft>) =>
    setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const create = () => {
    setError('');

    const height = parseLength(clearHeight, 'ft');
    if (height === null || height <= 0) {
      setError(`Could not read the clear height "${clearHeight}". Try 12', 12ft or 3600mm.`);
      return;
    }

    const specs: RoomSpec[] = [];
    for (const r of rooms) {
      const w = parseLength(r.width, 'ft');
      const d = parseLength(r.depth, 'ft');
      // Refusing beats guessing: a misread dimension silently corrupts every
      // quantity and every cost downstream of it.
      if (w === null || w <= 0) {
        setError(`Could not read the width "${r.width}" for ${r.name || 'an unnamed room'}.`);
        return;
      }
      if (d === null || d <= 0) {
        setError(`Could not read the depth "${r.depth}" for ${r.name || 'an unnamed room'}.`);
        return;
      }
      specs.push({
        name: r.name.trim() || `Room ${r.id}`,
        use: r.use,
        widthMm: w,
        depthMm: d,
      });
    }
    if (specs.length === 0) {
      setError('Add at least one room.');
      return;
    }

    const floors: FloorSpec[] = Array.from({ length: floorCount }, (_, i) => ({
      name: i === 0 ? 'Ground Floor' : `Floor ${i}`,
      level: i,
      clearHeightMm: height,
      floorToFloorMm: height + 305, // ~1 ft of structural zone above the clear height
      rooms: specs,
    }));

    onCreated(
      createProject(
        {
          name: name.trim() || 'Untitled project',
          buildingType,
          location: { city: city.trim(), country: 'Pakistan', authority },
          displayUnit: 'ft',
          floors,
        },
        new Date().toISOString(),
      ),
    );
  };

  return (
    <div>
      <h1>Project</h1>
      <p className="sub">
        Enter the building's real measurements. Every quantity and every cost in this application is
        derived from these numbers, so they are treated as measured facts: nothing downstream may
        change them, and a dimension that cannot be read is rejected rather than guessed at.
      </p>

      {project && (
        <div className="notice info">
          <strong>{project.name}</strong> is open. Creating a new project replaces it in this window;
          save first if you want to keep it.
        </div>
      )}

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="p-name">Project name</label>
            <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="p-type">Building type</label>
            <select
              id="p-type"
              value={buildingType}
              onChange={(e) => setBuildingType(e.target.value as BuildingType)}
            >
              {BUILDING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="p-city">City</label>
            <input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} />
            <div className="small muted" style={{ marginTop: 4 }}>
              Regulatory reference: <strong>{authority}</strong>
            </div>
          </div>
          <div>
            <label htmlFor="p-floors">Number of floors</label>
            <input
              id="p-floors"
              type="number"
              min={1}
              max={20}
              value={floorCount}
              onChange={(e) => setFloorCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="p-height">Clear floor-to-ceiling height</label>
            <input id="p-height" value={clearHeight} onChange={(e) => setClearHeight(e.target.value)} />
            <div className="small muted" style={{ marginTop: 4 }}>
              {(() => {
                const mm = parseLength(clearHeight, 'ft');
                return mm === null ? (
                  <span style={{ color: 'var(--err)' }}>unreadable</span>
                ) : (
                  <>
                    {formatLength(mm, 'ft', { imperialInches: true })} · {mm.toFixed(0)} mm
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      <h2>Rooms on each floor</h2>
      <p className="sub small">
        Accepts <span className="mono">15</span>, <span className="mono">15ft</span>,{' '}
        <span className="mono">15'</span>, <span className="mono">15' 6"</span>,{' '}
        <span className="mono">4572mm</span> or <span className="mono">4.5m</span>. Unsuffixed numbers
        are read as feet. Rooms are laid out in a strip with real partitions between them; move them
        to match the building in the 2D plan.
      </p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Name</th>
              <th style={{ width: '22%' }}>Use</th>
              <th style={{ width: '18%' }}>Width</th>
              <th style={{ width: '18%' }}>Depth</th>
              <th className="num">Area</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => {
              const w = parseLength(r.width, 'ft');
              const d = parseLength(r.depth, 'ft');
              const areaSqft = w !== null && d !== null ? (w * d) / 92_903.04 : null;
              return (
                <tr key={r.id}>
                  <td>
                    <input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} />
                  </td>
                  <td>
                    <select
                      value={r.use}
                      onChange={(e) => update(r.id, { use: e.target.value as RoomUse })}
                    >
                      {USES.map((u) => (
                        <option key={u} value={u}>
                          {u.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={r.width}
                      onChange={(e) => update(r.id, { width: e.target.value })}
                      style={w === null ? { borderColor: 'var(--err)' } : undefined}
                    />
                  </td>
                  <td>
                    <input
                      value={r.depth}
                      onChange={(e) => update(r.id, { depth: e.target.value })}
                      style={d === null ? { borderColor: 'var(--err)' } : undefined}
                    />
                  </td>
                  <td className="num">
                    {areaSqft === null ? (
                      <span style={{ color: 'var(--err)' }}>—</span>
                    ) : (
                      `${areaSqft.toFixed(0)} sq ft`
                    )}
                  </td>
                  <td>
                    <button
                      className="ghost"
                      onClick={() => setRooms((rs) => rs.filter((x) => x.id !== r.id))}
                      disabled={rooms.length === 1}
                      title={rooms.length === 1 ? 'A floor needs at least one room' : 'Remove'}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="ghost"
            onClick={() => setRooms((rs) => [...rs, draft('', 'office', "12'", "15'")])}
          >
            Add room
          </button>
        </div>
      </div>

      {error && <div className="notice err">{error}</div>}

      <div className="row">
        <button className="primary" onClick={create}>
          Create digital twin
        </button>
        <span className="small muted">
          Builds the 2D plan, the 3D model and the quantity takeoff from these dimensions.
        </span>
      </div>
    </div>
  );
}
