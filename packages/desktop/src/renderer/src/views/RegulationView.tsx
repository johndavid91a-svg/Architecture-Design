import { useMemo, useState } from 'react';
import {
  checkRegulations,
  computeMetrics,
  PARAMETER_SOURCES,
  parseLength,
  type PlanningParameters,
} from '@adp/core';
import type { ProjectStore } from '../state/project-store.js';

interface Props {
  readonly store: ProjectStore;
}

interface Draft {
  maxFar: string;
  maxGroundCoverage: string;
  maxHeight: string;
  maxFloors: string;
  frontSetback: string;
  rearSetback: string;
  sideSetback: string;
  parkingPer: string;
  parkingProvided: string;
  source: string;
}

const EMPTY: Draft = {
  maxFar: '',
  maxGroundCoverage: '',
  maxHeight: '',
  maxFloors: '',
  frontSetback: '',
  rearSetback: '',
  sideSetback: '',
  parkingPer: '',
  parkingProvided: '',
  source: '',
};

const numberOrUndefined = (raw: string): number | undefined => {
  const v = Number(raw);
  return raw.trim() !== '' && Number.isFinite(v) && v > 0 ? v : undefined;
};

export function RegulationView({ store }: Props): JSX.Element {
  const { project } = store;
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const authority = project?.architecture.site.location.authority ?? 'OTHER_PK';
  const sourceInfo = PARAMETER_SOURCES[authority];

  const params: PlanningParameters = useMemo(
    () => ({
      authority,
      source: draft.source || undefined,
      maxFar: numberOrUndefined(draft.maxFar),
      maxGroundCoverage: numberOrUndefined(draft.maxGroundCoverage)
        ? numberOrUndefined(draft.maxGroundCoverage)! / 100
        : undefined,
      maxHeightMm: draft.maxHeight ? (parseLength(draft.maxHeight, 'ft') ?? undefined) : undefined,
      maxFloors: numberOrUndefined(draft.maxFloors),
      frontSetbackMm: draft.frontSetback ? (parseLength(draft.frontSetback, 'ft') ?? undefined) : undefined,
      rearSetbackMm: draft.rearSetback ? (parseLength(draft.rearSetback, 'ft') ?? undefined) : undefined,
      sideSetbackMm: draft.sideSetback ? (parseLength(draft.sideSetback, 'ft') ?? undefined) : undefined,
      parkingBaysPerSqft: numberOrUndefined(draft.parkingPer)
        ? 1 / numberOrUndefined(draft.parkingPer)!
        : undefined,
      parkingBaysProvided: numberOrUndefined(draft.parkingProvided),
    }),
    [authority, draft],
  );

  const report = useMemo(
    () => (project ? checkRegulations(project.architecture, params) : null),
    [project, params],
  );
  const metrics = useMemo(
    () => (project ? computeMetrics(project.architecture) : null),
    [project],
  );

  if (!project || !report || !metrics) return <div className="list-empty">Create a project first.</div>;

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const issues = report.observations.filter((o) => o.severity !== 'not_checkable');
  const uncheckable = report.observations.filter((o) => o.severity === 'not_checkable');

  return (
    <div>
      <h1>Regulation observations — {authority}</h1>
      <p className="sub">
        Observations against parameters you enter, not a compliance determination. There is no "pass"
        anywhere in this view by design: a check either raises something or stays silent, and silence
        means "nothing detected against the figures on file", not "compliant".
      </p>

      <div className="notice">
        <strong>Enter the parameters that apply to your plot.</strong>
        <p className="small" style={{ margin: '6px 0 0' }}>
          CDA and RDA bye-laws vary by sector, plot category, land use and zone, and are amended by
          notification between consolidated editions. Nothing is shipped pre-filled, because a figure
          baked in here would be wrong for most plots and wrong invisibly.
          {sourceInfo.url && (
            <>
              {' '}
              Read them at{' '}
              <a href={sourceInfo.url} target="_blank" rel="noreferrer">
                {sourceInfo.name} ↗
              </a>
              .
            </>
          )}
        </p>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="k">Plot area</div>
          <div className="v">{metrics.plotAreaSqft.toFixed(0)}</div>
          <div className="n">sq ft</div>
        </div>
        <div className="stat">
          <div className="k">Ground coverage</div>
          <div className="v">
            {metrics.groundCoverageRatio !== null ? `${(metrics.groundCoverageRatio * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="n">{metrics.groundCoverageSqft.toFixed(0)} sq ft</div>
        </div>
        <div className="stat">
          <div className="k">FAR</div>
          <div className="v">{metrics.far !== null ? metrics.far.toFixed(2) : '—'}</div>
          <div className="n">{metrics.totalCoveredAreaSqft.toFixed(0)} sq ft covered</div>
        </div>
        <div className="stat">
          <div className="k">Height</div>
          <div className="v">{(metrics.buildingHeightMm / 304.8).toFixed(1)}</div>
          <div className="n">ft over {metrics.floorCount} floor(s)</div>
        </div>
      </div>

      <div className="card">
        <div className="grid cols-4">
          <div>
            <label htmlFor="rv-far">Max FAR</label>
            <input id="rv-far" value={draft.maxFar} onChange={set('maxFar')} placeholder="e.g. 3.5" />
          </div>
          <div>
            <label htmlFor="rv-cov">Max ground coverage %</label>
            <input id="rv-cov" value={draft.maxGroundCoverage} onChange={set('maxGroundCoverage')} placeholder="e.g. 60" />
          </div>
          <div>
            <label htmlFor="rv-h">Max height</label>
            <input id="rv-h" value={draft.maxHeight} onChange={set('maxHeight')} placeholder="e.g. 60ft" />
          </div>
          <div>
            <label htmlFor="rv-fl">Max floors</label>
            <input id="rv-fl" value={draft.maxFloors} onChange={set('maxFloors')} placeholder="e.g. 5" />
          </div>
        </div>
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="rv-fs">Front setback</label>
            <input id="rv-fs" value={draft.frontSetback} onChange={set('frontSetback')} placeholder="e.g. 20ft" />
          </div>
          <div>
            <label htmlFor="rv-rs">Rear setback</label>
            <input id="rv-rs" value={draft.rearSetback} onChange={set('rearSetback')} placeholder="e.g. 10ft" />
          </div>
          <div>
            <label htmlFor="rv-ss">Side setback</label>
            <input id="rv-ss" value={draft.sideSetback} onChange={set('sideSetback')} placeholder="e.g. 5ft" />
          </div>
          <div>
            <label htmlFor="rv-src">Where these came from</label>
            <input id="rv-src" value={draft.source} onChange={set('source')} placeholder="bye-law clause, letter…" />
          </div>
        </div>
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div>
            <label htmlFor="rv-pp">One parking bay per … sq ft</label>
            <input id="rv-pp" value={draft.parkingPer} onChange={set('parkingPer')} placeholder="e.g. 500" />
          </div>
          <div>
            <label htmlFor="rv-pv">Bays provided</label>
            <input id="rv-pv" value={draft.parkingProvided} onChange={set('parkingProvided')} placeholder="e.g. 12" />
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <>
          <h2>Potential issues</h2>
          {issues.map((o) => (
            <div key={o.code} className={o.severity === 'exceeds_limit' ? 'notice err' : 'notice'}>
              <strong>
                {o.title} — {o.severity === 'exceeds_limit' ? 'Potential regulation issue' : 'Close to the limit'}
              </strong>
              <div className="small" style={{ marginTop: 4 }}>
                {o.message}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Needs architect / engineer verification.
              </div>
            </div>
          ))}
        </>
      )}

      {issues.length === 0 && (
        <div className="notice info">
          <strong>Nothing detected against the parameters entered.</strong>
          <div className="small muted" style={{ marginTop: 4 }}>
            This is not a statement of compliance. Parameters you have not entered are not checked at
            all — see the list below.
          </div>
        </div>
      )}

      {uncheckable.length > 0 && (
        <>
          <h2>Not checked</h2>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <tbody>
                {uncheckable.map((o) => (
                  <tr key={o.code}>
                    <td style={{ width: 160 }}>{o.title}</td>
                    <td className="small muted">{o.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="notice">
        <strong>Disclaimer</strong>
        <div className="small" style={{ marginTop: 4 }}>
          {report.disclaimer}
        </div>
      </div>
    </div>
  );
}
