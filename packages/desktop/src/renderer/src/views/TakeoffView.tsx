import { useState } from 'react';
import { consolidate, findMaterial, type TakeoffResult } from '@adp/core';

interface Props {
  readonly takeoff: TakeoffResult;
}

const BASIS_LABEL: Record<string, string> = {
  measured_from_model: 'Measured from model',
  derived_with_coefficient: 'Derived with coefficient',
  counted_from_model: 'Counted from model',
  user_supplied: 'User supplied',
  requires_engineering: 'Requires engineering input',
};

export function TakeoffView({ takeoff }: Props): JSX.Element {
  const [grouped, setGrouped] = useState(false);
  const rows = grouped ? consolidate(takeoff.lines) : takeoff.lines;

  return (
    <div>
      <h1>Quantity takeoff</h1>
      <p className="sub">
        Every quantity below is derived from the model geometry, and every one carries the rule and
        the dimensions it came from. A number you cannot check is a number you cannot correct, so the
        derivation is part of the output rather than a debugging aid.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="k">Gross floor area</div>
          <div className="v">{takeoff.summary.grossFloorAreaSqft.toFixed(0)}</div>
          <div className="n">sq ft, from room polygons</div>
        </div>
        <div className="stat">
          <div className="k">Rooms</div>
          <div className="v">{takeoff.summary.roomCount}</div>
          <div className="n">across {takeoff.summary.floorCount} floor(s)</div>
        </div>
        <div className="stat">
          <div className="k">Doors</div>
          <div className="v">{takeoff.summary.doorCount}</div>
          <div className="n">counted from openings</div>
        </div>
        <div className="stat">
          <div className="k">Windows</div>
          <div className="v">{takeoff.summary.windowCount}</div>
          <div className="n">counted from openings</div>
        </div>
      </div>

      {takeoff.gaps.length > 0 && (
        <div className="notice">
          <strong>{takeoff.gaps.length} quantities cannot come from a floor plan.</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {takeoff.gaps.map((g) => (
              <li key={g.key} style={{ marginBottom: 6 }}>
                <strong>{g.description}</strong> — {g.gap}
              </li>
            ))}
          </ul>
          <div className="small muted" style={{ marginTop: 8 }}>
            These are reported rather than approximated. A rule-of-thumb figure here would be
            indistinguishable from a measured one in the BOQ, which is exactly the problem.
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <button className="ghost" onClick={() => setGrouped((g) => !g)}>
          {grouped ? 'Show by location' : 'Consolidate by material'}
        </button>
        <span className="small muted">
          {rows.length} line{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Material</th>
              <th className="num">Quantity</th>
              <th>Unit</th>
              <th>Basis</th>
              <th style={{ width: '32%' }}>Derivation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => {
              const material = line.materialId ? findMaterial(line.materialId) : undefined;
              return (
                <tr key={line.key}>
                  <td>{line.description}</td>
                  <td className="muted small">{material?.name ?? '—'}</td>
                  <td className="num">
                    {line.quantity.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="small">{line.unit}</td>
                  <td className="small">{BASIS_LABEL[line.basis] ?? line.basis}</td>
                  <td className="small muted">{line.derivation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
