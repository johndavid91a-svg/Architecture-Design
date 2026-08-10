/**
 * Project state.
 *
 * One place that owns the twin, its edit history and its design options. The
 * views read from it and dispatch through it; none of them mutate a project
 * directly.
 *
 * The important property: every architecture edit goes through `applyEdit`,
 * which mints an authorisation from a direct user gesture. There is no other
 * path from the UI to the geometry, so an agent's output cannot reach it — an
 * agent produces a design-layer proposal, and design-layer proposals go through
 * `replaceDesign`, which cannot touch architecture at all.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  activeDesign as pickActiveDesign,
  allFloors,
  assertGeometryUnchanged,
  History,
  newId,
  recomputeBoundingWalls,
  userAuthorisation,
  type ArchitectureLayer,
  type Design,
  type DesignId,
  type EditResult,
  type Floor,
  type Project,
  type VersionId,
  type PlanningParameters,
} from '@adp/core';

export interface ProjectStore {
  readonly project: Project | null;
  readonly floors: readonly Floor[];
  readonly design: Design | undefined;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly lastMessage: string;
  readonly reviewAcknowledged: boolean;

  setProject(project: Project): void;
  /**
   * Record the planning limits for this plot.
   *
   * Not an architecture edit — it changes no geometry — so it does not need an
   * authorisation and does not go on the undo stack. It does need to persist,
   * which is the whole point: limits held in a screen's state vanish on the
   * next tab change, and nobody enters a bye-law schedule twice.
   */
  setPlanning(planning: PlanningParameters | undefined): void;
  acknowledgeReview(value: boolean): void;
  /** Run an architecture edit. Returns null on success, or the refusal reason. */
  applyEdit(run: (arch: ArchitectureLayer, auth: ReturnType<typeof userAuthorisation>) => EditResult): string | null;
  undo(): void;
  redo(): void;

  addDesign(design: Design): void;
  replaceDesign(design: Design): void;
  setActiveDesign(id: DesignId): void;
  deleteDesign(id: DesignId): void;
  duplicateDesign(id: DesignId, name: string): void;
  newDesignIds(): { designId: DesignId; versionId: VersionId };
  setMessage(message: string): void;
}

export function useProjectStore(): ProjectStore {
  const [project, setProjectState] = useState<Project | null>(null);
  const [lastMessage, setLastMessage] = useState('');
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  // Bumped whenever history moves, so the memoised views recompute.
  const [revision, setRevision] = useState(0);

  const historyRef = useRef<History<ArchitectureLayer> | null>(null);

  const setProject = useCallback((next: Project) => {
    setProjectState(next);
    historyRef.current = new History(next.architecture, 'Opened project');
    setRevision((r) => r + 1);
  }, []);

  const setPlanning = useCallback((planning: PlanningParameters | undefined) => {
    setProjectState((current) => (current ? { ...current, planning } : current));
    setRevision((r) => r + 1);
  }, []);

  const applyEdit = useCallback(
    (run: (arch: ArchitectureLayer, auth: ReturnType<typeof userAuthorisation>) => EditResult): string | null => {
      if (!project) return 'No project is open.';
      if (!reviewAcknowledged) {
        return (
          'Acknowledge the professional-review notice before editing the architecture. ' +
          'Changing a wall in the model is not the same as changing it on site.'
        );
      }

      const auth = userAuthorisation(project.architecture.projectId, 'Plan editor change', true);
      const result = run(project.architecture, auth);
      if (!result.ok) return result.reason;

      // Wall-to-room association drives which openings are deducted from which
      // room's wall area. Leaving it stale after a structural edit produces
      // quantities that look right and are not.
      const settled = recomputeBoundingWalls(
        result.architecture,
        allFloors({ ...project, architecture: result.architecture })[0]?.id ??
          result.architecture.site.buildings[0]!.floors[0]!.id,
      );

      historyRef.current?.push(settled, result.description);
      setProjectState({ ...project, architecture: settled });
      setLastMessage(result.description);
      setRevision((r) => r + 1);
      return null;
    },
    [project, reviewAcknowledged],
  );

  const undo = useCallback(() => {
    if (!project || !historyRef.current) return;
    const previous = historyRef.current.undo();
    if (!previous) return;
    setProjectState({ ...project, architecture: previous });
    setLastMessage('Undone');
    setRevision((r) => r + 1);
  }, [project]);

  const redo = useCallback(() => {
    if (!project || !historyRef.current) return;
    const next = historyRef.current.redo();
    if (!next) return;
    setProjectState({ ...project, architecture: next });
    setLastMessage('Redone');
    setRevision((r) => r + 1);
  }, [project]);

  const addDesign = useCallback(
    (design: Design) => {
      if (!project) return;
      setProjectState({
        ...project,
        designs: [...project.designs, design],
        activeDesignId: design.id,
      });
      setRevision((r) => r + 1);
    },
    [project],
  );

  /**
   * Replace a design in place.
   *
   * Asserts the architecture is untouched even though a `Design` carries no
   * geometry. It costs one hash and it closes the door on a future refactor
   * quietly opening a path from a design operation to the twin.
   */
  const replaceDesign = useCallback(
    (design: Design) => {
      if (!project) return;
      assertGeometryUnchanged(project.architecture, project.architecture);
      setProjectState({
        ...project,
        designs: project.designs.map((d) => (d.id === design.id ? design : d)),
      });
      setRevision((r) => r + 1);
    },
    [project],
  );

  const setActiveDesign = useCallback(
    (id: DesignId) => {
      if (!project) return;
      setProjectState({ ...project, activeDesignId: id });
      setRevision((r) => r + 1);
    },
    [project],
  );

  const deleteDesign = useCallback(
    (id: DesignId) => {
      if (!project || project.designs.length <= 1) return;
      const remaining = project.designs.filter((d) => d.id !== id);
      setProjectState({
        ...project,
        designs: remaining,
        activeDesignId: project.activeDesignId === id ? remaining[0]!.id : project.activeDesignId,
      });
      setRevision((r) => r + 1);
    },
    [project],
  );

  const duplicateDesign = useCallback(
    (id: DesignId, name: string) => {
      if (!project) return;
      const source = project.designs.find((d) => d.id === id);
      if (!source) return;
      const copy: Design = {
        ...source,
        id: newId<DesignId>('dsg'),
        versionId: newId<VersionId>('ver'),
        name,
        createdAt: new Date().toISOString(),
        origin: { kind: 'duplicated', parentDesignId: source.id },
      };
      setProjectState({ ...project, designs: [...project.designs, copy], activeDesignId: copy.id });
      setRevision((r) => r + 1);
    },
    [project],
  );

  const newDesignIds = useCallback(
    () => ({ designId: newId<DesignId>('dsg'), versionId: newId<VersionId>('ver') }),
    [],
  );

  const floors = useMemo(
    () => (project ? allFloors(project) : []),
    // `revision` is the signal that history moved; the project object identity
    // alone would not change on an undo that restores an equal-but-new object.
    [project, revision],
  );
  const design = useMemo(() => (project ? pickActiveDesign(project) : undefined), [project, revision]);

  return {
    project,
    floors,
    design,
    canUndo: historyRef.current?.canUndo ?? false,
    canRedo: historyRef.current?.canRedo ?? false,
    undoLabel: historyRef.current?.undoLabel ?? null,
    lastMessage,
    reviewAcknowledged,
    setProject,
    setPlanning,
    acknowledgeReview: setReviewAcknowledged,
    applyEdit,
    undo,
    redo,
    addDesign,
    replaceDesign,
    setActiveDesign,
    deleteDesign,
    duplicateDesign,
    newDesignIds,
    setMessage: setLastMessage,
  };
}
