import { useCallback, useMemo, useState } from 'react';
import { computeTakeoff, type Project } from '@adp/core';
import { SetupView } from './views/SetupView.js';
import { DrawingsView } from './views/DrawingsView.js';
import { PlanView } from './views/PlanView.js';
import { WalkthroughView } from './views/WalkthroughView.js';
import { DesignView } from './views/DesignView.js';
import { TakeoffView } from './views/TakeoffView.js';
import { EstimateView } from './views/EstimateView.js';
import { OptionsView } from './views/OptionsView.js';
import { SourcingView } from './views/SourcingView.js';
import { RegulationView } from './views/RegulationView.js';
import { ReportView } from './views/ReportView.js';
import { SourcesView } from './views/SourcesView.js';
import { ThemesView } from './views/ThemesView.js';
import { PriceBook } from './state/price-book.js';
import { useProjectStore } from './state/project-store.js';
import { captureAll } from './state/view-capture.js';

type Tab =
  | 'setup'
  | 'drawings'
  | 'plan'
  | 'walk'
  | 'design'
  | 'options'
  | 'takeoff'
  | 'estimate'
  | 'sourcing'
  | 'regulation'
  | 'report'
  | 'themes'
  | 'sources';

const TABS: ReadonlyArray<{ id: Tab; label: string; needsProject: boolean }> = [
  { id: 'setup', label: 'Project', needsProject: false },
  // Before the plan, deliberately: the drawings are the document the user
  // recognises, and everything after this tab is this app's reading of them.
  { id: 'drawings', label: 'Drawings', needsProject: false },
  { id: 'plan', label: '2D Plan', needsProject: true },
  { id: 'walk', label: '3D', needsProject: true },
  { id: 'design', label: 'Design', needsProject: true },
  { id: 'options', label: 'Options', needsProject: true },
  { id: 'takeoff', label: 'Quantities', needsProject: true },
  { id: 'estimate', label: 'Estimate / BOQ', needsProject: true },
  { id: 'sourcing', label: 'Sourcing', needsProject: true },
  { id: 'regulation', label: 'Regulation', needsProject: true },
  { id: 'report', label: 'Report', needsProject: true },
  { id: 'themes', label: 'Themes', needsProject: false },
  { id: 'sources', label: 'Price Sources', needsProject: false },
];

const FULL_BLEED: ReadonlySet<Tab> = new Set(['drawings', 'plan', 'walk']);

export function App(): JSX.Element {
  const store = useProjectStore();
  const [tab, setTab] = useState<Tab>('setup');
  const [status, setStatus] = useState('');
  /**
   * The file the current project was imported from.
   *
   * Held for the session rather than saved into the project: it is a path on
   * this machine, and a project file that carries one is a project file that
   * breaks when it is opened anywhere else.
   */
  const [drawingPath, setDrawingPath] = useState('');

  // One price book per session. It starts EMPTY — the application ships no
  // prices at all, by design. See PriceBook for why.
  const [priceBook] = useState(() => new PriceBook());
  const [priceVersion, setPriceVersion] = useState(0);
  const bumpPrices = useCallback(() => setPriceVersion((v) => v + 1), []);

  const takeoff = useMemo(
    () => (store.floors.length > 0 ? computeTakeoff(store.floors, store.design) : null),
    [store.floors, store.design],
  );

  const onCreated = useCallback(
    (created: Project) => {
      store.setProject(created);
      setTab('plan');
      setStatus(`Created "${created.name}".`);
    },
    [store],
  );

  const save = useCallback(async () => {
    if (!store.project) return;
    try {
      const summary = await window.desktop.saveProject(store.project);
      setStatus(`Saved to ${summary.path}`);
    } catch (error) {
      setStatus(`Save failed: ${(error as Error).message}`);
    }
  }, [store.project]);

  const message = status || store.lastMessage;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Architecture Design
          <small>digital twin · design · estimation</small>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="tab"
              role="tab"
              aria-selected={tab === t.id}
              disabled={t.needsProject && !store.project}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {message && (
          <span className="small muted" style={{ marginRight: 12, maxWidth: 360 }}>
            {message}
          </span>
        )}
        <button className="ghost" onClick={save} disabled={!store.project}>
          Save
        </button>
      </header>

      <main className={FULL_BLEED.has(tab) ? 'content full' : 'content'}>
        {tab === 'setup' && (
          <SetupView project={store.project} onCreated={onCreated} onImported={setDrawingPath} />
        )}
        {tab === 'drawings' && <DrawingsView path={drawingPath} />}
        {tab === 'plan' && <PlanView store={store} />}
        {tab === 'walk' && store.project && (
          <WalkthroughView
            project={store.project}
            floors={store.floors}
            design={store.design}
            designs={store.project.designs}
            onSelectDesign={store.setActiveDesign}
          />
        )}
        {tab === 'design' && <DesignView store={store} />}
        {tab === 'options' && (
          <OptionsView store={store} priceBook={priceBook} priceVersion={priceVersion} />
        )}
        {tab === 'takeoff' && takeoff && <TakeoffView takeoff={takeoff} />}
        {tab === 'estimate' && takeoff && store.project && (
          <EstimateView
            project={store.project}
            takeoff={takeoff}
            priceBook={priceBook}
            priceVersion={priceVersion}
            onPricesChanged={bumpPrices}
          />
        )}
        {tab === 'sourcing' && (
          <SourcingView store={store} priceBook={priceBook} priceVersion={priceVersion} />
        )}
        {tab === 'regulation' && <RegulationView store={store} />}
        {tab === 'report' && (
          <ReportView
            store={store}
            priceBook={priceBook}
            priceVersion={priceVersion}
            captureViews={captureAll}
          />
        )}
        {tab === 'themes' && <ThemesView />}
        {tab === 'sources' && <SourcesView />}
      </main>
    </div>
  );
}
