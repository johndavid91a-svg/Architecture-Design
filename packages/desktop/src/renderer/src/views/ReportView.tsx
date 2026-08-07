import { useMemo, useState } from 'react';
import {
  buildReportHtml,
  checkRegulations,
  compareDesigns,
  computeTakeoff,
  DEFAULT_SETTINGS,
  estimate,
  findTheme,
  totalCaveat,
  type BudgetScenario,
} from '@adp/core';
import type { ProjectStore } from '../state/project-store.js';
import type { PriceBook } from '../state/price-book.js';

interface Props {
  readonly store: ProjectStore;
  readonly priceBook: PriceBook;
  readonly priceVersion: number;
  /** Captures of the plan and 3D views, taken on demand. */
  readonly captureViews: () => Promise<ReadonlyArray<{ caption: string; dataUri: string }>>;
}

export function ReportView({ store, priceBook, priceVersion, captureViews }: Props): JSX.Element {
  const { project, floors, design } = store;
  const [scenario, setScenario] = useState<BudgetScenario>('STANDARD');
  const [contingency, setContingency] = useState(10);
  const [includeImages, setIncludeImages] = useState(true);
  const [includeRegulation, setIncludeRegulation] = useState(false);
  const [includeComparison, setIncludeComparison] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const takeoff = useMemo(
    () => (floors.length > 0 ? computeTakeoff(floors, design) : null),
    [floors, design],
  );

  const result = useMemo(() => {
    if (!takeoff) return null;
    return estimate(
      [...takeoff.lines, ...takeoff.gaps],
      (materialId) => priceBook.lookup(materialId),
      (trade) => priceBook.lookupLabour(trade),
      { ...DEFAULT_SETTINGS, scenario, contingency: contingency / 100 },
    );
  }, [takeoff, priceBook, priceVersion, scenario, contingency]);

  const buildHtml = async (): Promise<string | null> => {
    if (!project || !takeoff || !result) return null;

    const images = includeImages ? await captureViews() : [];
    const comparison =
      includeComparison && project.designs.length > 1
        ? compareDesigns(
            project.designs,
            floors,
            (materialId) => priceBook.lookup(materialId),
            (trade) => priceBook.lookupLabour(trade),
            { ...DEFAULT_SETTINGS, scenario, contingency: contingency / 100 },
          )
        : undefined;

    const regulation = includeRegulation
      ? checkRegulations(project.architecture, {
          authority: project.architecture.site.location.authority,
        })
      : undefined;

    return buildReportHtml({
      projectName: project.name,
      location: `${project.architecture.site.location.city}, ${project.architecture.site.location.country}`,
      buildingType: project.architecture.buildingType,
      generatedAt: new Date().toISOString(),
      takeoff,
      estimate: result,
      caveat: totalCaveat(result),
      theme: design?.themeId ? findTheme(design.themeId) : undefined,
      regulation,
      comparison,
      images,
    });
  };

  const exportPdf = async () => {
    setBusy(true);
    setMessage('');
    try {
      const html = await buildHtml();
      if (!html || !project) return;
      const out = await window.desktop.exportPdf({
        suggestedName: `${project.name.replace(/[^\w -]/g, '')} — Cost estimate.pdf`,
        html,
      });
      setMessage(
        out.saved
          ? `Exported to ${out.path}`
          : out.error
            ? `Export failed: ${out.error}`
            : 'Export cancelled.',
      );
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async () => {
    setBusy(true);
    try {
      setPreview(await buildHtml());
    } finally {
      setBusy(false);
    }
  };

  if (!project || !result || !takeoff) return <div className="list-empty">Create a project first.</div>;

  return (
    <div>
      <h1>Report and presentation</h1>
      <p className="sub">
        One document definition serves both the preview here and the exported PDF, rendered through
        the same engine — so the file cannot quietly disagree with what you were shown. Everything in
        it comes from the same calculations as the rest of the application; the report recomputes
        nothing of its own.
      </p>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="rp-scenario">Budget scenario</label>
            <select
              id="rp-scenario"
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
            <label htmlFor="rp-cont">Contingency %</label>
            <input
              id="rp-cont"
              type="number"
              min={0}
              max={50}
              value={contingency}
              onChange={(e) => setContingency(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
            <div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={includeImages}
                  onChange={(e) => setIncludeImages(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span className="small">Include plan and 3D views</span>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={includeComparison}
                  onChange={(e) => setIncludeComparison(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span className="small">Include option comparison</span>
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={includeRegulation}
                  onChange={(e) => setIncludeRegulation(e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <span className="small">Include regulation observations</span>
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="primary" onClick={exportPdf} disabled={busy}>
              {busy ? 'Working…' : 'Export PDF'}
            </button>
            <button className="ghost" onClick={showPreview} disabled={busy}>
              Preview
            </button>
          </div>
        </div>
      </div>

      {!result.complete && (
        <div className="notice">
          <strong>The report will state that the estimate is incomplete.</strong>
          <div className="small" style={{ marginTop: 4 }}>
            {result.unpricedLineCount} of {result.lines.length} lines are unpriced. They appear in the
            bill of quantities as gaps, and the cover shows the total as <em>at least</em> rather than
            as a figure. A report that hid this would be the most dangerous thing this application
            could produce.
          </div>
        </div>
      )}

      {message && <div className="notice info">{message}</div>}

      <h2>Contents</h2>
      <div className="card">
        <table>
          <tbody>
            <tr>
              <td style={{ width: 190 }}>Cover</td>
              <td className="small muted">
                Project, location, area, floors, theme, and the headline figure with its caveat.
              </td>
            </tr>
            {includeImages && (
              <tr>
                <td>Views</td>
                <td className="small muted">Plan and 3D captures taken from the live model.</td>
              </tr>
            )}
            {design?.themeId && (
              <tr>
                <td>Design rationale</td>
                <td className="small muted">
                  Theme identity, palette, lighting character and signature elements with reasoning.
                </td>
              </tr>
            )}
            <tr>
              <td>Areas and counts</td>
              <td className="small muted">
                {takeoff.summary.grossFloorAreaSqft.toFixed(0)} sq ft, {takeoff.summary.roomCount} rooms,{' '}
                {takeoff.summary.doorCount} doors, {takeoff.summary.windowCount} windows.
              </td>
            </tr>
            <tr>
              <td>Cost summary</td>
              <td className="small muted">
                Material, labour, transport, equipment, contingency, total — separated, never merged.
              </td>
            </tr>
            {includeComparison && project.designs.length > 1 && (
              <tr>
                <td>Option comparison</td>
                <td className="small muted">{project.designs.length} options over one architecture.</td>
              </tr>
            )}
            <tr>
              <td>Bill of quantities</td>
              <td className="small muted">
                {result.lines.length} lines with source, date and confidence on each.
                {result.unpricedLineCount > 0 && ` ${result.unpricedLineCount} shown as gaps.`}
              </td>
            </tr>
            <tr>
              <td>Labour</td>
              <td className="small muted">
                Worker-days by trade with a suggested crew and duration.
              </td>
            </tr>
            {includeRegulation && (
              <tr>
                <td>Regulation observations</td>
                <td className="small muted">Metrics and observations, with the disclaimer.</td>
              </tr>
            )}
            <tr>
              <td>Assumptions</td>
              <td className="small muted">{result.assumptions.length} stated assumptions.</td>
            </tr>
            <tr>
              <td>Professional review</td>
              <td className="small muted">Always included, never optional.</td>
            </tr>
          </tbody>
        </table>
      </div>

      {preview && (
        <>
          <h2>Preview</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <iframe
              title="Report preview"
              srcDoc={preview}
              sandbox=""
              style={{ width: '100%', height: '70vh', border: 0, background: '#fff' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
