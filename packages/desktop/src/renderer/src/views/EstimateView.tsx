import { useMemo, useState } from 'react';
import {
  BASE_MATERIALS,
  boqToCsv,
  buildBoq,
  DEFAULT_SETTINGS,
  estimate,
  findMaterial,
  importPriceCsv,
  priceListTemplate,
  PROFESSIONAL_REVIEW_NOTICE,
  TRADE_LABELS,
  totalCaveat,
  type BudgetScenario,
  type ImportResult,
  type MaterialId,
  type Project,
  type PriceUnit,
  type TakeoffResult,
  type TradeCode,
} from '@adp/core';
import type { PriceBook } from '../state/price-book.js';

interface Props {
  readonly project: Project;
  readonly takeoff: TakeoffResult;
  readonly priceBook: PriceBook;
  readonly priceVersion: number;
  readonly onPricesChanged: () => void;
}

const UNITS: readonly PriceUnit[] = [
  'sqft',
  'sqm',
  'each',
  'rft',
  'cft',
  'cum',
  'bag_50kg',
  'kg',
  'tonne',
  'thousand',
  'litre',
];

const fmt = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export function EstimateView({
  project,
  takeoff,
  priceBook,
  priceVersion,
  onPricesChanged,
}: Props): JSX.Element {
  const [scenario, setScenario] = useState<BudgetScenario>('STANDARD');
  const [contingency, setContingency] = useState(10);
  const [message, setMessage] = useState('');

  const result = useMemo(
    () =>
      estimate(
        [...takeoff.lines, ...takeoff.gaps],
        (materialId) => priceBook.lookup(materialId),
        (trade) => priceBook.lookupLabour(trade),
        { ...DEFAULT_SETTINGS, scenario, contingency: contingency / 100 },
      ),
    // priceVersion is the dependency that matters: the price book is mutable,
    // so the version counter is what tells React the estimate is stale.
    [takeoff, priceBook, priceVersion, scenario, contingency],
  );

  const boq = useMemo(() => buildBoq(result), [result]);

  /** Materials the takeoff actually needs, so the price form is not a catalogue dump. */
  const neededMaterials = useMemo(() => {
    const ids = new Set<MaterialId>();
    for (const line of takeoff.lines) if (line.materialId) ids.add(line.materialId);
    return BASE_MATERIALS.filter((m) => ids.has(m.id));
  }, [takeoff]);

  const neededTrades = useMemo(() => {
    const trades = new Set<TradeCode>();
    for (const line of result.lines) for (const c of line.labourBreakdown) trades.add(c.trade);
    return [...trades];
  }, [result]);

  const exportCsv = async () => {
    const csv = [
      `# ${project.name} — Bill of Quantities`,
      `# Generated ${new Date().toISOString()}`,
      '#',
      ...PROFESSIONAL_REVIEW_NOTICE.split('\n').map((l) => `# ${l}`),
      '',
      boqToCsv(boq, result),
    ].join('\r\n');
    const out = await window.desktop.exportCsv({
      suggestedName: `${project.name.replace(/[^\w -]/g, '')} BOQ.csv`,
      contents: csv,
    });
    setMessage(out.saved ? `Exported to ${out.path}` : 'Export cancelled.');
  };

  return (
    <div>
      <h1>Estimate and Bill of Quantities</h1>
      <p className="sub">
        Quantities come from the model. Prices come from whatever you have recorded, with their
        source and date attached. Nothing here is filled in with a plausible-looking number: lines
        without a price stay in the BOQ as gaps and stay out of the total.
      </p>

      {priceBook.isEmpty && (
        <div className="notice">
          <strong>No prices are on file, so nothing can be costed yet.</strong>
          <p style={{ margin: '8px 0 0' }}>
            The application ships with an empty price book on purpose. Pakistani material rates have
            moved sharply within single months, so a rate baked into the installer would be wrong,
            and wrong invisibly, inside a figure you might quote against. Record a supplier quotation
            below, or open <strong>Price Sources</strong> for the official and market sources this
            product is built to draw from.
          </p>
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="k">Material</div>
          <div className="v">{fmt(result.materialCost)}</div>
          <div className="n">{result.currency}, priced lines only</div>
        </div>
        <div className="stat">
          <div className="k">Labour</div>
          <div className="v">{fmt(result.labourCost)}</div>
          <div className="n">{result.currency}, separate from material</div>
        </div>
        <div className="stat">
          <div className="k">Contingency</div>
          <div className="v">{fmt(result.contingencyAmount)}</div>
          <div className="n">{contingency}% of subtotal</div>
        </div>
        <div className="stat">
          <div className="k">{result.complete ? 'Total' : 'At least'}</div>
          <div className="v" style={{ color: result.complete ? 'var(--ok)' : 'var(--warn)' }}>
            {fmt(result.total)}
          </div>
          <div className="n">{result.currency}</div>
        </div>
      </div>

      <div className={result.complete ? 'notice info' : 'notice'}>
        <strong>{totalCaveat(result)}</strong>
        <div className="small muted" style={{ marginTop: 6 }}>
          {result.pricedLineCount} of {result.lines.length} lines priced (
          {(result.completeness * 100).toFixed(0)}%). Lowest confidence on any priced line:{' '}
          {result.lowestConfidence}.
        </div>
      </div>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="scenario">Budget scenario</label>
            <select
              id="scenario"
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
          <div>
            <label htmlFor="cont">Contingency %</label>
            <input
              id="cont"
              type="number"
              min={0}
              max={50}
              value={contingency}
              onChange={(e) => setContingency(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="ghost" onClick={exportCsv}>
              Export BOQ as CSV
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            {message && <span className="small muted">{message}</span>}
          </div>
        </div>
      </div>

      <PriceEntry
        materials={neededMaterials}
        trades={neededTrades}
        priceBook={priceBook}
        onAdded={onPricesChanged}
      />

      <h2>Bill of Quantities</h2>
      <div className="card" style={{ padding: 0, overflow: 'auto', maxHeight: '60vh' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th style={{ minWidth: 220 }}>Description</th>
              <th>Unit</th>
              <th className="num">Qty</th>
              <th className="num">Mat. rate</th>
              <th className="num">Mat. cost</th>
              <th className="num">Labour</th>
              <th className="num">Transport</th>
              <th className="num">Subtotal</th>
              <th>Source</th>
              <th>Date</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {boq.map((row, i) => {
              const isGap = row.subtotal === 'EXCLUDED FROM TOTAL';
              return (
                <tr key={`${row.item}-${i}`} className={isGap ? 'gap' : undefined}>
                  <td className="muted">{row.item}</td>
                  <td>{row.description}</td>
                  <td className="small">{row.unit}</td>
                  <td className="num">{row.quantity}</td>
                  <td className="num">{row.materialRate}</td>
                  <td className="num">{row.materialCost}</td>
                  <td className="num">{row.labourCost}</td>
                  <td className="num">{row.transport}</td>
                  <td className="num">{row.subtotal}</td>
                  <td className="small muted">{row.source}</td>
                  <td className="small muted">{row.priceDate.slice(0, 10)}</td>
                  <td className="small">
                    {isGap ? (
                      <span className="badge gap" title={row.confidence}>
                        GAP
                      </span>
                    ) : (
                      <span className={`badge ${row.confidence.toLowerCase()}`}>{row.confidence}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {result.workerDaysByTrade.size > 0 && (
        <>
          <h2>Labour</h2>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Trade</th>
                  <th className="num">Worker-days</th>
                  <th>Rate status</th>
                </tr>
              </thead>
              <tbody>
                {[...result.workerDaysByTrade.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([trade, days]) => {
                    const lookup = priceBook.lookupLabour(trade);
                    return (
                      <tr key={trade}>
                        <td>{TRADE_LABELS[trade]}</td>
                        <td className="num">{days.toFixed(1)}</td>
                        <td className="small">
                          {lookup.available ? (
                            <>
                              {fmt(lookup.rate.amount)} {lookup.rate.currency}/day{' '}
                              <span className={`badge ${lookup.confidence.toLowerCase()}`}>
                                {lookup.confidence}
                              </span>
                            </>
                          ) : (
                            <span className="badge gap">NO RATE</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Assumptions</h2>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {result.assumptions.map((a) => (
            <li key={a} className="small" style={{ marginBottom: 6 }}>
              {a}
            </li>
          ))}
        </ul>
      </div>

      <div className="notice">
        <strong>Professional review</strong>
        <pre
          className="small muted"
          style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', fontFamily: 'inherit' }}
        >
          {PROFESSIONAL_REVIEW_NOTICE}
        </pre>
      </div>
    </div>
  );
}

/**
 * Price-list import.
 *
 * Extraction is a proposal, never a commitment. Every parsed row is shown with
 * whatever problems were found, and nothing becomes a price record until the
 * user presses the button. A delimiter or OCR misread of a decimal point is a
 * 10× error in a figure someone will act on, and it is completely invisible
 * once it is a number in a table.
 */
function PriceListImport({
  priceBook,
  onAdded,
}: {
  priceBook: PriceBook;
  onAdded: () => void;
}): JSX.Element {
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [filename, setFilename] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    const file = await window.desktop.importCsv();
    if (file.cancelled) return;
    if (file.error) {
      setNote(file.error);
      return;
    }
    setFilename(file.filename ?? '');
    setParsed(importPriceCsv(file.contents ?? '', { currency: 'PKR' }));
    setNote('');
  };

  const commit = () => {
    if (!parsed) return;
    let added = 0;
    for (const row of parsed.rows) {
      if (!row.importable || !row.materialId || row.amount === null || !row.unit) continue;
      priceBook.addPrice({
        materialId: row.materialId,
        amount: row.amount,
        currency: row.currency,
        unit: row.unit,
        location: 'As supplied',
        specification: row.specification,
        kind: 'supplier_quote',
        supplierName: row.supplier,
      });
      added++;
    }
    setNote(`Recorded ${added} price(s) as supplier quotations.`);
    setParsed(null);
    onAdded();
  };

  const downloadTemplate = async () => {
    const out = await window.desktop.exportCsv({
      suggestedName: 'price-list-template.csv',
      contents: priceListTemplate(),
    });
    setNote(out.saved ? `Template saved to ${out.path}` : 'Cancelled.');
  };

  return (
    <div className="card">
      <div className="row">
        <button className="ghost" onClick={load}>
          Choose a CSV price list…
        </button>
        <button className="ghost" onClick={downloadTemplate}>
          Download a template
        </button>
        {filename && <span className="small muted">{filename}</span>}
      </div>

      {note && (
        <div className="small" style={{ marginTop: 8, color: 'var(--muted)' }}>
          {note}
        </div>
      )}

      {parsed && (
        <>
          {parsed.warnings.map((w) => (
            <div key={w} className="notice" style={{ marginTop: 10 }}>
              {w}
            </div>
          ))}

          {parsed.rows.length > 0 && (
            <>
              <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Description</th>
                      <th>Matched material</th>
                      <th className="num">Rate</th>
                      <th>Unit</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map((r) => (
                      <tr key={r.row} className={r.importable ? undefined : 'gap'}>
                        <td className="muted">{r.row}</td>
                        <td className="small">{r.rawDescription}</td>
                        <td className="small">
                          {r.materialId ? (
                            <>
                              {findMaterial(r.materialId)?.name}
                              <span className="muted"> ({(r.matchConfidence * 100).toFixed(0)}%)</span>
                            </>
                          ) : (
                            <span className="muted">no match</span>
                          )}
                        </td>
                        <td className="num">{r.amount ?? '—'}</td>
                        <td className="small">{r.unit ?? '—'}</td>
                        <td className="small">
                          {r.importable ? (
                            <span className="badge high">READY</span>
                          ) : (
                            <span title={r.problems.join(' ')} className="badge gap">
                              {r.problems[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={commit} disabled={parsed.importableCount === 0}>
                  Record {parsed.importableCount} price(s)
                </button>
                <span className="small muted">
                  {parsed.problemCount > 0
                    ? `${parsed.problemCount} row(s) will be skipped. Fix them in the file and re-import, or enter them by hand.`
                    : 'All rows read cleanly.'}
                </span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PriceEntry({
  materials,
  trades,
  priceBook,
  onAdded,
}: {
  materials: typeof BASE_MATERIALS;
  trades: readonly TradeCode[];
  priceBook: PriceBook;
  onAdded: () => void;
}): JSX.Element {
  const [materialId, setMaterialId] = useState<string>(materials[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<PriceUnit>('sqft');
  const [kind, setKind] = useState<'supplier_quote' | 'user_estimate'>('supplier_quote');
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState('Islamabad');
  const [spec, setSpec] = useState('');

  const [trade, setTrade] = useState<string>(trades[0] ?? 'mason');
  const [wage, setWage] = useState('');

  const material = materialId ? findMaterial(materialId as MaterialId) : undefined;

  const addPrice = () => {
    const value = Number(amount);
    if (!materialId || !Number.isFinite(value) || value <= 0) return;
    priceBook.addPrice({
      materialId: materialId as MaterialId,
      amount: value,
      currency: 'PKR',
      unit,
      location,
      specification: spec || undefined,
      kind,
      supplierName: supplier || undefined,
    });
    setAmount('');
    onAdded();
  };

  const addWage = () => {
    const value = Number(wage);
    if (!Number.isFinite(value) || value <= 0) return;
    priceBook.addLabourRate({
      trade: trade as TradeCode,
      amount: value,
      currency: 'PKR',
      location,
      kind,
    });
    setWage('');
    onAdded();
  };

  return (
    <>
      <h2>Import a price list</h2>
      <PriceListImport priceBook={priceBook} onAdded={onAdded} />

      <h2>Record a price</h2>
      <p className="sub small">
        A quotation you are looking at is recorded as a supplier quote and counts as verified today.
        Anything you enter from memory is recorded as an estimate and is permanently reported at low
        confidence — the distinction is what keeps a guess from reading like research later.
      </p>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="pe-mat">Material</label>
            <select id="pe-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {material && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Takeoff unit: <span className="mono">{material.takeoffUnit}</span> · default wastage{' '}
                {(material.defaultWastage * 100).toFixed(0)}%
              </div>
            )}
          </div>
          <div>
            <label htmlFor="pe-amt">Rate (PKR)</label>
            <input
              id="pe-amt"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 450"
            />
          </div>
          <div>
            <label htmlFor="pe-unit">Per</label>
            <select id="pe-unit" value={unit} onChange={(e) => setUnit(e.target.value as PriceUnit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pe-kind">Basis</label>
            <select
              id="pe-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="supplier_quote">Supplier quotation (Level 3)</option>
              <option value="user_estimate">My own estimate (Level 4)</option>
            </select>
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="pe-sup">Supplier</label>
            <input id="pe-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pe-loc">Location</label>
            <input id="pe-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pe-spec">Brand / grade</label>
            <input
              id="pe-spec"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder="a rate without a grade cannot be compared"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="primary" onClick={addPrice} disabled={!amount}>
              Record price
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="pe-trade">Trade</label>
            <select id="pe-trade" value={trade} onChange={(e) => setTrade(e.target.value)}>
              {(trades.length > 0 ? trades : (Object.keys(TRADE_LABELS) as TradeCode[])).map((t) => (
                <option key={t} value={t}>
                  {TRADE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pe-wage">Daily wage (PKR)</label>
            <input
              id="pe-wage"
              inputMode="decimal"
              value={wage}
              onChange={(e) => setWage(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="primary" onClick={addWage} disabled={!wage}>
              Record wage rate
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <span className="small muted">
              Worker-days are already known from the model; only the rate is missing.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
