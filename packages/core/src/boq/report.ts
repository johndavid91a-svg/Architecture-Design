/**
 * Presentation and estimate report.
 *
 * Produces a self-contained HTML document. The desktop app prints it to PDF
 * through Electron, which means one document definition serves both the
 * on-screen presentation and the exported file — rather than a PDF that quietly
 * disagrees with what the user was shown.
 *
 * Everything in the report is derived from the same engines as the UI. There is
 * no separate "report calculation", because a report that recomputes anything
 * is a second source of truth waiting to drift.
 */

import type { EstimateResult } from '../estimate/estimate.js';
import type { TakeoffResult } from '../takeoff/takeoff.js';
import type { RegulationReport } from '../regulation/checker.js';
import type { ComparisonResult } from '../design/compare.js';
import type { Theme } from '../themes/theme.js';
import { buildBoq, PROFESSIONAL_REVIEW_NOTICE } from './boq.js';
import { TRADE_LABELS } from '../catalogue/materials.js';
import { planCrew } from '../estimate/labour.js';

export interface ReportInput {
  readonly projectName: string;
  readonly location: string;
  readonly buildingType: string;
  readonly generatedAt: string;
  readonly takeoff: TakeoffResult;
  readonly estimate: EstimateResult;
  readonly caveat: string;
  readonly theme?: Theme;
  readonly regulation?: RegulationReport;
  readonly comparison?: ComparisonResult;
  /** Data-URI PNGs captured from the plan and 3D views. */
  readonly images?: ReadonlyArray<{ readonly caption: string; readonly dataUri: string }>;
}

/** Escape for HTML text content and attribute values. */
function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (v: number | undefined, digits = 0): string =>
  v === undefined
    ? '—'
    : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function buildReportHtml(input: ReportInput): string {
  const { estimate: est, takeoff } = input;
  const boq = buildBoq(est);
  const crew = planCrew(est.workerDaysByTrade);

  const totalLabel = est.complete ? 'Estimated total' : 'Estimated total (incomplete)';
  const totalValue = est.complete
    ? `${num(est.total)} ${est.currency}`
    : `at least ${num(est.total)} ${est.currency}`;

  const sections: string[] = [];

  // ---- Cover -----------------------------------------------------------
  sections.push(`
<section class="cover">
  <div class="cover-kicker">Project cost estimate</div>
  <h1>${esc(input.projectName)}</h1>
  <div class="cover-meta">
    <div><span>Location</span>${esc(input.location)}</div>
    <div><span>Building type</span>${esc(input.buildingType.replace(/_/g, ' '))}</div>
    <div><span>Gross floor area</span>${num(takeoff.summary.grossFloorAreaSqft)} sq ft</div>
    <div><span>Floors</span>${takeoff.summary.floorCount}</div>
    ${input.theme ? `<div><span>Design theme</span>${esc(input.theme.name)}</div>` : ''}
    <div><span>Generated</span>${esc(input.generatedAt.slice(0, 10))}</div>
  </div>
  <div class="cover-total ${est.complete ? '' : 'incomplete'}">
    <div class="k">${totalLabel}</div>
    <div class="v">${totalValue}</div>
    <div class="n">${esc(input.caveat)}</div>
  </div>
</section>`);

  // ---- Views -----------------------------------------------------------
  if (input.images && input.images.length > 0) {
    sections.push(`
<section>
  <h2>Views</h2>
  <div class="figures">
    ${input.images
      .map(
        (img) => `<figure><img src="${esc(img.dataUri)}" alt="${esc(img.caption)}" /><figcaption>${esc(img.caption)}</figcaption></figure>`,
      )
      .join('')}
  </div>
</section>`);
  }

  // ---- Design rationale ------------------------------------------------
  if (input.theme) {
    sections.push(`
<section>
  <h2>Design rationale</h2>
  <p class="lead">${esc(input.theme.identity)}</p>
  <table class="kv">
    <tr><th>Palette</th><td>
      <span class="chip" style="background:${esc(input.theme.palette.primary)}"></span>
      <span class="chip" style="background:${esc(input.theme.palette.secondary)}"></span>
      <span class="chip" style="background:${esc(input.theme.palette.accent)}"></span>
      ${esc(input.theme.palette.accentUsage)}
    </td></tr>
    <tr><th>Lighting</th><td>${esc(input.theme.lighting.description)} ${input.theme.lighting.colourTemperatureK}K</td></tr>
    <tr><th>Ceiling</th><td>${esc(input.theme.ceilingKind.replace(/_/g, ' '))}</td></tr>
    ${input.theme.facadeSystem ? `<tr><th>Façade</th><td>${esc(input.theme.facadeSystem.replace(/_/g, ' '))}</td></tr>` : ''}
  </table>
  <h3>Signature elements</h3>
  <ul>
    ${input.theme.signatureElements
      .map(
        (s) =>
          `<li><strong>${esc(String(s.where).replace(/_/g, ' '))}:</strong> ${esc(s.element)}<br /><span class="muted">${esc(s.rationale)}</span></li>`,
      )
      .join('')}
  </ul>
</section>`);
  }

  // ---- Areas -----------------------------------------------------------
  sections.push(`
<section>
  <h2>Areas and counts</h2>
  <div class="stats">
    <div class="stat"><span class="k">Gross floor area</span><span class="v">${num(takeoff.summary.grossFloorAreaSqft)}</span><span class="n">sq ft</span></div>
    <div class="stat"><span class="k">Rooms</span><span class="v">${takeoff.summary.roomCount}</span><span class="n">across ${takeoff.summary.floorCount} floor(s)</span></div>
    <div class="stat"><span class="k">Doors</span><span class="v">${takeoff.summary.doorCount}</span><span class="n">counted from model</span></div>
    <div class="stat"><span class="k">Windows</span><span class="v">${takeoff.summary.windowCount}</span><span class="n">counted from model</span></div>
  </div>
</section>`);

  // ---- Cost summary ----------------------------------------------------
  sections.push(`
<section>
  <h2>Cost summary</h2>
  <table class="totals">
    <tr><th>Material</th><td class="num">${num(est.materialCost)}</td></tr>
    <tr><th>Labour</th><td class="num">${num(est.labourCost)}</td></tr>
    <tr><th>Transport</th><td class="num">${num(est.transportCost)}</td></tr>
    <tr><th>Equipment</th><td class="num">${num(est.equipmentCost)}</td></tr>
    <tr class="rule"><th>Subtotal</th><td class="num">${num(est.subtotal)}</td></tr>
    <tr><th>Contingency</th><td class="num">${num(est.contingencyAmount)}</td></tr>
    <tr class="grand"><th>${esc(totalLabel)}</th><td class="num">${esc(totalValue)}</td></tr>
  </table>
  ${
    est.complete
      ? ''
      : `<div class="warn"><strong>${est.unpricedLineCount} of ${est.lines.length} lines could not be priced</strong> and are excluded from the figure above. The true cost is higher. Unpriced lines are listed in the bill of quantities below with the reason and what is needed.</div>`
  }
</section>`);

  // ---- Option comparison -----------------------------------------------
  if (input.comparison && input.comparison.options.length > 1) {
    sections.push(`
<section>
  <h2>Design option comparison</h2>
  <p class="lead">${esc(input.comparison.statement)}</p>
  <table>
    <thead><tr><th>Option</th><th class="num">Material</th><th class="num">Labour</th><th class="num">Contingency</th><th class="num">Total</th><th>Completeness</th></tr></thead>
    <tbody>
      ${input.comparison.options
        .map(
          (o) => `<tr>
        <td>${esc(o.label ?? o.name)}</td>
        <td class="num">${num(o.materialCost)}</td>
        <td class="num">${num(o.labourCost)}</td>
        <td class="num">${num(o.contingency)}</td>
        <td class="num">${o.total === null ? '<span class="gap">not fully priced</span>' : num(o.total)}</td>
        <td>${(o.completeness * 100).toFixed(0)}%</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p class="muted small">Every option shares one architecture, so a difference here is entirely the effect of specification.</p>
</section>`);
  }

  // ---- BOQ -------------------------------------------------------------
  sections.push(`
<section class="break">
  <h2>Bill of quantities</h2>
  <table class="boq">
    <thead>
      <tr>
        <th>#</th><th>Description</th><th>Unit</th><th class="num">Qty</th>
        <th class="num">Mat. rate</th><th class="num">Mat. cost</th><th class="num">Labour</th>
        <th class="num">Subtotal</th><th>Source</th><th>Date</th><th>Conf.</th>
      </tr>
    </thead>
    <tbody>
      ${boq
        .map((r) => {
          const gap = r.subtotal === 'EXCLUDED FROM TOTAL';
          return `<tr class="${gap ? 'gaprow' : ''}">
        <td>${esc(r.item)}</td><td>${esc(r.description)}</td><td>${esc(r.unit)}</td>
        <td class="num">${esc(r.quantity)}</td><td class="num">${esc(r.materialRate)}</td>
        <td class="num">${esc(r.materialCost)}</td><td class="num">${esc(r.labourCost)}</td>
        <td class="num">${esc(r.subtotal)}</td><td class="small">${esc(r.source)}</td>
        <td class="small">${esc(r.priceDate.slice(0, 10))}</td>
        <td class="small">${gap ? '<span class="gap">GAP</span>' : esc(r.confidence)}</td>
      </tr>`;
        })
        .join('')}
    </tbody>
  </table>
</section>`);

  // ---- Labour ----------------------------------------------------------
  if (crew.length > 0) {
    sections.push(`
<section>
  <h2>Labour</h2>
  <table>
    <thead><tr><th>Trade</th><th class="num">Worker-days</th><th class="num">Suggested crew</th><th class="num">Days</th></tr></thead>
    <tbody>
      ${crew
        .map(
          (c) =>
            `<tr><td>${esc(TRADE_LABELS[c.trade])}</td><td class="num">${c.workerDays.toFixed(1)}</td><td class="num">${c.suggestedCrewSize}</td><td class="num">${c.estimatedDays}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <p class="muted small">A resourcing estimate, not a programme. It assumes the work is divisible and the crew continuously available.</p>
</section>`);
  }

  // ---- Regulation ------------------------------------------------------
  if (input.regulation) {
    const r = input.regulation;
    sections.push(`
<section>
  <h2>Regulation observations — ${esc(r.authority)}</h2>
  <table class="kv">
    <tr><th>Plot area</th><td>${num(r.metrics.plotAreaSqft)} sq ft</td></tr>
    <tr><th>Ground coverage</th><td>${num(r.metrics.groundCoverageSqft)} sq ft${r.metrics.groundCoverageRatio !== null ? ` (${(r.metrics.groundCoverageRatio * 100).toFixed(1)}%)` : ''}</td></tr>
    <tr><th>Total covered area</th><td>${num(r.metrics.totalCoveredAreaSqft)} sq ft</td></tr>
    <tr><th>FAR</th><td>${r.metrics.far !== null ? r.metrics.far.toFixed(2) : '—'}</td></tr>
    <tr><th>Height</th><td>${(r.metrics.buildingHeightMm / 304.8).toFixed(2)} ft</td></tr>
  </table>
  ${
    r.observations.length === 0
      ? '<p class="muted">No observations were raised against the parameters on file.</p>'
      : `<ul class="obs">${r.observations
          .map(
            (o) =>
              `<li class="${esc(o.severity)}"><strong>${esc(o.title)}</strong> — ${esc(o.message)}</li>`,
          )
          .join('')}</ul>`
  }
  <div class="warn">${esc(r.disclaimer)}</div>
</section>`);
  }

  // ---- Assumptions and notice ------------------------------------------
  sections.push(`
<section>
  <h2>Assumptions</h2>
  <ul>${est.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
</section>

<section>
  <h2>Sources</h2>
  <p class="muted small">Every priced line carries its source and the date the figure was retrieved or verified, shown in the bill of quantities. Prices are not fabricated: where no current price could be sourced, the line is reported as a gap.</p>
</section>

<section class="notice-block">
  <h2>Professional review</h2>
  <pre>${esc(PROFESSIONAL_REVIEW_NOTICE)}</pre>
</section>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(input.projectName)} — Cost estimate</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; color: #16191d; margin: 0; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 14px; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 2px solid #16191d; }
  h3 { font-size: 12px; margin: 14px 0 6px; }
  section { margin-bottom: 26px; page-break-inside: avoid; }
  section.break { page-break-before: always; }
  .cover { border-bottom: 3px solid #16191d; padding-bottom: 20px; }
  .cover-kicker { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: #6b7280; margin-bottom: 6px; }
  .cover-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 20px; margin: 16px 0; }
  .cover-meta div { font-size: 11px; }
  .cover-meta span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
  .cover-total { margin-top: 16px; padding: 14px 16px; background: #f3f5f7; border-left: 4px solid #1f7a4d; }
  .cover-total.incomplete { border-left-color: #b7791f; }
  .cover-total .k { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; }
  .cover-total .v { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .cover-total .n { font-size: 10px; color: #4b5563; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #dfe3e8; vertical-align: top; }
  thead th { background: #f3f5f7; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #4b5563; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  table.kv th { width: 150px; color: #4b5563; font-weight: 500; }
  table.totals { max-width: 380px; }
  table.totals th { font-weight: 500; color: #374151; }
  table.totals tr.rule th, table.totals tr.rule td { border-top: 2px solid #16191d; font-weight: 700; }
  table.totals tr.grand th, table.totals tr.grand td { border-top: 2px solid #16191d; font-size: 13px; font-weight: 700; }
  .boq { font-size: 8.5px; }
  .boq td, .boq th { padding: 3px 4px; }
  tr.gaprow td { background: #fdf0ef; }
  .gap { color: #b42318; font-weight: 700; }
  .warn { margin-top: 12px; padding: 10px 12px; background: #fdf6e7; border-left: 3px solid #b7791f; font-size: 10px; }
  .muted { color: #6b7280; }
  .small { font-size: 9px; }
  .lead { font-size: 12px; margin: 0 0 12px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .stat { background: #f3f5f7; padding: 10px 12px; }
  .stat .k { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; }
  .stat .v { display: block; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .stat .n { display: block; font-size: 9px; color: #6b7280; }
  .chip { display: inline-block; width: 16px; height: 16px; border-radius: 3px; border: 1px solid #cbd2d9; vertical-align: -3px; margin-right: 3px; }
  .figures { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  figure { margin: 0; }
  figure img { width: 100%; border: 1px solid #dfe3e8; }
  figcaption { font-size: 9px; color: #6b7280; margin-top: 4px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 5px; }
  ul.obs li.exceeds_limit { color: #b42318; }
  ul.obs li.near_limit { color: #b7791f; }
  ul.obs li.not_checkable { color: #6b7280; }
  .notice-block pre { white-space: pre-wrap; font: 10px/1.6 inherit; background: #f3f5f7; padding: 12px 14px; margin: 0; }
</style>
</head>
<body>
${sections.join('\n')}
</body>
</html>`;
}
