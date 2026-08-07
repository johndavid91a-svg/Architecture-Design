import { useMemo, useState } from 'react';
import {
  compareDesigns,
  DEFAULT_SETTINGS,
  diffOptions,
  type BudgetScenario,
  type DesignId,
} from '@adp/core';
import type { ProjectStore } from '../state/project-store.js';
import type { PriceBook } from '../state/price-book.js';

interface Props {
  readonly store: ProjectStore;
  readonly priceBook: PriceBook;
  readonly priceVersion: number;
}

const fmt = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function OptionsView({ store, priceBook, priceVersion }: Props): JSX.Element {
  const { project, floors, design } = store;
  const [scenario, setScenario] = useState<BudgetScenario>('STANDARD');
  const [compareA, setCompareA] = useState<DesignId | ''>('');
  const [compareB, setCompareB] = useState<DesignId | ''>('');

  const comparison = useMemo(() => {
    if (!project) return null;
    return compareDesigns(
      project.designs,
      floors,
      (materialId) => priceBook.lookup(materialId),
      (trade) => priceBook.lookupLabour(trade),
      { ...DEFAULT_SETTINGS, scenario },
    );
  }, [project, floors, priceBook, priceVersion, scenario]);

  const deltas = useMemo(() => {
    if (!comparison || !compareA || !compareB) return null;
    const a = comparison.options.find((o) => o.designId === compareA);
    const b = comparison.options.find((o) => o.designId === compareB);
    if (!a || !b) return null;
    return { a, b, lines: diffOptions(a, b).slice(0, 25) };
  }, [comparison, compareA, compareB]);

  if (!project || !comparison) return <div className="list-empty">Create a project first.</div>;

  return (
    <div>
      <h1>Design options</h1>
      <p className="sub">
        Every option shares one architecture — same rooms, same areas, same quantities of floor and
        wall. So a cost difference between two options is entirely the effect of specification, with
        nothing else moving. That is what makes the question "which is cheaper" answerable at all.
      </p>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="ov-scenario">Budget scenario</label>
            <select
              id="ov-scenario"
              value={scenario}
              onChange={(e) => setScenario(e.target.value as BudgetScenario)}
            >
              {(['ECONOMY', 'STANDARD', 'PREMIUM', 'LUXURY', 'CUSTOM'] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={comparison.cheapest ? 'notice info' : 'notice'}>
        <strong>{comparison.statement}</strong>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Origin</th>
              <th className="num">Material</th>
              <th className="num">Labour</th>
              <th className="num">Transport</th>
              <th className="num">Contingency</th>
              <th className="num">Total</th>
              <th>Priced</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {comparison.options.map((o) => {
              const d = project.designs.find((x) => x.id === o.designId)!;
              const isActive = design?.id === o.designId;
              const isCheapest = comparison.cheapest?.designId === o.designId;
              return (
                <tr key={o.designId} style={isActive ? { background: 'rgba(74,163,223,0.08)' } : undefined}>
                  <td>
                    <strong>{o.label ?? o.name}</strong>
                    {isCheapest && (
                      <span className="badge high" style={{ marginLeft: 6 }}>
                        CHEAPEST
                      </span>
                    )}
                    {isActive && (
                      <span className="badge medium" style={{ marginLeft: 6 }}>
                        ACTIVE
                      </span>
                    )}
                  </td>
                  <td className="small muted">{d.origin.kind.replace(/_/g, ' ')}</td>
                  <td className="num">{fmt(o.materialCost)}</td>
                  <td className="num">{fmt(o.labourCost)}</td>
                  <td className="num">{fmt(o.transportCost)}</td>
                  <td className="num">{fmt(o.contingency)}</td>
                  <td className="num">
                    {o.total === null ? (
                      <span className="badge gap">not fully priced</span>
                    ) : (
                      <strong>{fmt(o.total)}</strong>
                    )}
                  </td>
                  <td className="small">
                    <span
                      className={`badge ${o.complete ? 'high' : o.completeness > 0.5 ? 'medium' : 'low'}`}
                    >
                      {(o.completeness * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      <button
                        className="ghost"
                        style={{ padding: '3px 9px' }}
                        onClick={() => store.setActiveDesign(o.designId)}
                        disabled={isActive}
                      >
                        Use
                      </button>
                      <button
                        className="ghost"
                        style={{ padding: '3px 9px' }}
                        onClick={() => store.duplicateDesign(o.designId, `${o.name} (copy)`)}
                      >
                        Duplicate
                      </button>
                      <button
                        className="ghost"
                        style={{ padding: '3px 9px' }}
                        onClick={() => store.deleteDesign(o.designId)}
                        disabled={project.designs.length <= 1}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Before / after</h2>
      <p className="sub small">
        Pick two options to see exactly which lines account for the difference between them, largest
        first. This is the answer to "why is that one more expensive".
      </p>

      <div className="card">
        <div className="grid cols-2">
          <div>
            <label htmlFor="ov-a">Before</label>
            <select id="ov-a" value={compareA} onChange={(e) => setCompareA(e.target.value as DesignId)}>
              <option value="">Choose an option…</option>
              {comparison.options.map((o) => (
                <option key={o.designId} value={o.designId}>
                  {o.label ?? o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ov-b">After</label>
            <select id="ov-b" value={compareB} onChange={(e) => setCompareB(e.target.value as DesignId)}>
              <option value="">Choose an option…</option>
              {comparison.options.map((o) => (
                <option key={o.designId} value={o.designId}>
                  {o.label ?? o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {deltas && (
        <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '50vh' }}>
          <table>
            <thead>
              <tr>
                <th>Line</th>
                <th className="num">{deltas.a.label ?? deltas.a.name}</th>
                <th className="num">{deltas.b.label ?? deltas.b.name}</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {deltas.lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted small" style={{ padding: 18 }}>
                    No costed differences between these two options.
                  </td>
                </tr>
              )}
              {deltas.lines.map((d) => (
                <tr key={d.key}>
                  <td className="small">{d.description}</td>
                  <td className="num">{fmt(d.aCost)}</td>
                  <td className="num">{fmt(d.bCost)}</td>
                  <td
                    className="num"
                    style={{ color: (d.delta ?? 0) > 0 ? 'var(--err)' : 'var(--ok)' }}
                  >
                    {d.delta === null ? '—' : `${d.delta > 0 ? '+' : ''}${fmt(d.delta)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
