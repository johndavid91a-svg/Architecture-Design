import { useState } from 'react';
import {
  countUnconfirmed,
  importScaleCheck,
  materialise,
  polygonArea,
  type CandidateFloor,
  type ImportIssue,
  type Project,
  type RegulatoryAuthority,
} from '@adp/core';

interface Props {
  readonly projectName: string;
  readonly city: string;
  readonly authority: RegulatoryAuthority;
  readonly onCreated: (project: Project) => void;
}

interface State {
  readonly filename: string;
  readonly format: string;
  readonly floors: CandidateFloor[];
  readonly issues: ImportIssue[];
  readonly schema?: string;
  readonly needsCalibration?: boolean;
}

const sqft = (mm2: number) => mm2 / 92_903.04;

/**
 * Attach a real drawing and turn it into the twin.
 *
 * The whole screen is built around one idea: an import is a *proposal*. Nothing
 * becomes the master record until the user has seen what was read and what was
 * guessed at. IFC arrives mostly `verified` — the file states its walls and
 * spaces — while a PDF or DXF arrives entirely `extracted`, because a pair of
 * parallel lines might be a wall or might be a kerb, and only a person can say.
 */
export function ImportPanel({ projectName, city, authority, onCreated }: Props): JSX.Element {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const choose = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await window.desktop.importDrawing();
      if (result.cancelled) return;
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setState({
        filename: String(result.filename ?? ''),
        format: String(result.format ?? ''),
        floors: (result.floors ?? []) as CandidateFloor[],
        issues: (result.issues ?? []) as ImportIssue[],
        schema: result.schema,
        needsCalibration: result.needsCalibration,
      });
    } catch (error) {
      setMessage(`Import failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const accept = () => {
    if (!state || state.floors.length === 0) return;
    const result = materialise(
      {
        name: projectName || state.filename.split('/').pop() || 'Imported building',
        buildingType: 'commercial_plaza',
        location: { city, country: 'Pakistan', authority },
        displayUnit: 'ft',
        floors: state.floors,
      },
      new Date().toISOString(),
    );
    const dropped = result.issues.filter((i) => i.severity === 'review').length;
    if (dropped > 0) {
      setMessage(
        `Imported. ${dropped} element(s) were dropped on validation — see the plan for what survived.`,
      );
    }
    onCreated(result.project);
  };

  const blocking = state?.issues.filter((i) => i.severity === 'blocking') ?? [];
  const review = state?.issues.filter((i) => i.severity === 'review') ?? [];
  const scale = state ? importScaleCheck(state.floors) : null;
  const unconfirmed = state
    ? countUnconfirmed({
        ok: true,
        format: 'ifc',
        units: { unit: 'm', source: 'file_header', confident: true, note: '' },
        floors: state.floors,
        issues: state.issues,
        stats: { floorCount: 0, roomCount: 0, wallCount: 0, openingCount: 0, skipped: {}, parseMs: 0 },
      })
    : 0;

  return (
    <>
      <div className="card">
        <div className="row">
          <button className="primary" onClick={choose} disabled={busy}>
            {busy ? 'Reading the drawing…' : 'Attach a drawing…'}
          </button>
          <span className="small muted">
            IFC or DXF, or a vector PDF. IFC gives the most accurate model by a wide margin — it
            carries walls and rooms as real objects with declared dimensions.
          </span>
        </div>
        {message && (
          <div className="small" style={{ marginTop: 8, color: 'var(--err)' }}>
            {message}
          </div>
        )}
      </div>

      {state && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{state.filename.split('/').pop()}</strong>
                <div className="small muted">
                  {state.format.toUpperCase()}
                  {state.schema ? ` · ${state.schema}` : ''} · {state.floors.length} floor(s) read
                </div>
              </div>
              <button className="primary" onClick={accept} disabled={state.floors.length === 0}>
                Use this as the building
              </button>
            </div>
          </div>

          {blocking.map((issue) => (
            <div key={issue.code} className="notice err">
              <strong>{issue.message}</strong>
              {issue.remedy && (
                <div className="small" style={{ marginTop: 4 }}>
                  {issue.remedy}
                </div>
              )}
            </div>
          ))}

          {scale && state.floors.length > 0 && (
            <div className={scale.plausible ? 'notice info' : 'notice err'}>
              <strong>Sense-check the size before you accept it.</strong>
              <div className="small" style={{ marginTop: 4 }}>
                {scale.note} Largest room {scale.largestRoomSqft.toFixed(0)} sq ft, total wall run{' '}
                {scale.totalWallRunFt.toFixed(0)} ft.
              </div>
            </div>
          )}

          {unconfirmed > 0 && (
            <div className="notice">
              <strong>{unconfirmed} element(s) were read automatically and are not confirmed.</strong>
              <div className="small" style={{ marginTop: 4 }}>
                They carry an <span className="mono">extracted</span> or{' '}
                <span className="mono">inferred</span> confidence into the model, and the plan view
                shows it per room. Check them before relying on any quantity.
              </div>
            </div>
          )}

          {state.floors.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '40vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Floor</th>
                    <th className="num">Level</th>
                    <th className="num">Elevation</th>
                    <th className="num">Rooms</th>
                    <th className="num">Walls</th>
                    <th className="num">Openings</th>
                    <th className="num">Area</th>
                    <th>Largest rooms</th>
                  </tr>
                </thead>
                <tbody>
                  {state.floors.map((floor) => {
                    const area = floor.rooms.reduce((s, r) => s + sqft(polygonArea(r.boundary)), 0);
                    const openings = floor.walls.reduce((n, w) => n + w.openings.length, 0);
                    const largest = [...floor.rooms]
                      .sort((a, b) => polygonArea(b.boundary) - polygonArea(a.boundary))
                      .slice(0, 3)
                      .map((r) => `${r.name} ${sqft(polygonArea(r.boundary)).toFixed(0)}sf`)
                      .join(', ');
                    return (
                      <tr key={`${floor.name}-${floor.level}`}>
                        <td>{floor.name}</td>
                        <td className="num">{floor.level}</td>
                        <td className="num">{(floor.elevation / 304.8).toFixed(1)} ft</td>
                        <td className="num">{floor.rooms.length}</td>
                        <td className="num">{floor.walls.length}</td>
                        <td className="num">{openings}</td>
                        <td className="num">{area.toFixed(0)} sq ft</td>
                        <td className="small muted">{largest || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {review.length > 0 && (
            <>
              <h2>What needs checking</h2>
              <div className="card" style={{ padding: 0 }}>
                <table>
                  <tbody>
                    {review.slice(0, 12).map((issue, i) => (
                      <tr key={`${issue.code}-${i}`}>
                        <td style={{ width: 170 }} className="small mono muted">
                          {issue.code}
                        </td>
                        <td className="small">
                          {issue.message}
                          {issue.remedy && (
                            <div className="muted" style={{ marginTop: 2 }}>
                              {issue.remedy}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {review.length > 12 && (
                <div className="small muted">…and {review.length - 12} more.</div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
