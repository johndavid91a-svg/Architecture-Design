import { useCallback, useMemo, useState } from 'react';
import {
  activeDesign,
  allFloors,
  computeTakeoff,
  type Project,
} from '@adp/core';
import { SetupView } from './views/SetupView.js';
import { PlanView } from './views/PlanView.js';
import { WalkthroughView } from './views/WalkthroughView.js';
import { TakeoffView } from './views/TakeoffView.js';
import { EstimateView } from './views/EstimateView.js';
import { SourcesView } from './views/SourcesView.js';
import { ThemesView } from './views/ThemesView.js';
import { PriceBook } from './state/price-book.js';

type Tab = 'setup' | 'plan' | 'walk' | 'takeoff' | 'estimate' | 'themes' | 'sources';

const TABS: ReadonlyArray<{ id: Tab; label: string; needsProject: boolean }> = [
  { id: 'setup', label: 'Project', needsProject: false },
  { id: 'plan', label: '2D Plan', needsProject: true },
  { id: 'walk', label: '3D Walkthrough', needsProject: true },
  { id: 'takeoff', label: 'Quantities', needsProject: true },
  { id: 'estimate', label: 'Estimate / BOQ', needsProject: true },
  { id: 'themes', label: 'Themes', needsProject: false },
  { id: 'sources', label: 'Price Sources', needsProject: false },
];

export function App(): JSX.Element {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>('setup');
  const [status, setStatus] = useState<string>('');

  // One price book per session. It starts EMPTY — the application ships no
  // prices at all, by design. See PriceBook for why.
  const [priceBook] = useState(() => new PriceBook());
  const [priceVersion, setPriceVersion] = useState(0);
  const bumpPrices = useCallback(() => setPriceVersion((v) => v + 1), []);

  const floors = useMemo(() => (project ? allFloors(project) : []), [project]);
  const design = useMemo(() => (project ? activeDesign(project) : undefined), [project]);
  const takeoff = useMemo(
    () => (floors.length > 0 ? computeTakeoff(floors, design) : null),
    [floors, design],
  );

  const onCreated = useCallback((created: Project) => {
    setProject(created);
    setTab('plan');
    setStatus(`Created "${created.name}".`);
  }, []);

  const save = useCallback(async () => {
    if (!project) return;
    try {
      const summary = await window.desktop.saveProject(project);
      setStatus(`Saved to ${summary.path}`);
    } catch (error) {
      setStatus(`Save failed: ${(error as Error).message}`);
    }
  }, [project]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Architecture Design
          <small>digital twin · design · estimation</small>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            disabled={t.needsProject && !project}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div className="spacer" />
        {status && (
          <span className="small muted" style={{ marginRight: 12, maxWidth: 420 }}>
            {status}
          </span>
        )}
        <button className="ghost" onClick={save} disabled={!project}>
          Save project
        </button>
      </header>

      <main className={tab === 'walk' || tab === 'plan' ? 'content full' : 'content'}>
        {tab === 'setup' && <SetupView project={project} onCreated={onCreated} />}
        {tab === 'plan' && project && <PlanView project={project} />}
        {tab === 'walk' && project && <WalkthroughView project={project} />}
        {tab === 'takeoff' && takeoff && <TakeoffView takeoff={takeoff} />}
        {tab === 'estimate' && takeoff && (
          <EstimateView
            project={project!}
            takeoff={takeoff}
            priceBook={priceBook}
            priceVersion={priceVersion}
            onPricesChanged={bumpPrices}
          />
        )}
        {tab === 'themes' && <ThemesView />}
        {tab === 'sources' && <SourcesView />}
      </main>
    </div>
  );
}
