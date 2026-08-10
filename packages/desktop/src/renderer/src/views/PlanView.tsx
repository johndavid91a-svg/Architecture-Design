import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addOpening,
  boundsOf,
  centroid,
  deleteOpening,
  deleteWall,
  estimateCapacity,
  formatLength,
  fromMm2,
  moveRoom,
  moveWall,
  parseLength,
  pointInPolygon,
  polygonArea,
  resizeRoom,
  setRoomProperties,
  setWallProperties,
  distancePointToSegment,
  type Floor,
  type OpeningId,
  type Room,
  type RoomUse,
  type Wall,
  type WallId,
  buildTour,
  tourPointAt,
} from '@adp/core';
import type { ProjectStore } from '../state/project-store.js';
import { cacheFrame, registerCanvas } from '../state/view-capture.js';

interface Props {
  readonly store: ProjectStore;
}

type Selection =
  | { kind: 'none' }
  | { kind: 'room'; room: Room }
  | { kind: 'wall'; wall: Wall };

/** Snap increment while dragging. Three inches — a real construction module. */
const SNAP_MM = 76.2;

/**
 * How the plan is drawn.
 *
 * The first palette here failed the only test that matters: walls at #5d6b7d on
 * a #0d1116 ground are a contrast ratio of about 2.4:1, and a 1 px grid at
 * #1a2029 is 1.3:1 — both below the 3:1 floor for a graphical object, so on a
 * bright screen the drawing simply was not there. The dark palette below puts
 * walls near white and lifts the room wash and grid until each step is
 * separable; every value was chosen against the ground it sits on rather than
 * for its own sake.
 *
 * `paper` is the same drawing the way a plan is actually printed: black line
 * work on white. It is not a novelty — it is the highest-contrast rendering
 * possible, it matches the sheet the user is comparing against, and it is what
 * to switch to in a lit room or on a projector.
 */
interface Palette {
  readonly ground: string;
  readonly gridMinor: string;
  readonly gridMajor: string;
  readonly roomFill: string;
  readonly roomStroke: string;
  readonly wallBearing: string;
  readonly wallPartition: string;
  readonly selection: string;
  readonly selectionFill: string;
  readonly door: string;
  readonly window: string;
  readonly exit: string;
  readonly label: string;
  readonly sublabel: string;
  /** Painted behind text so a label crossing a wall stays readable. */
  readonly labelHalo: string;
  readonly route: string;
}

const PALETTES: Record<'dark' | 'paper', Palette> = {
  dark: {
    ground: '#0b0f14',
    gridMinor: 'rgba(126,152,184,0.17)',
    gridMajor: 'rgba(126,152,184,0.34)',
    roomFill: 'rgba(128,168,214,0.17)',
    roomStroke: '#7d93ab',
    wallBearing: '#f4f7fb',
    wallPartition: '#b3c1d1',
    selection: '#5cc0ff',
    selectionFill: 'rgba(92,192,255,0.30)',
    door: '#ffc14d',
    window: '#5fd0ff',
    exit: '#ff6f6a',
    label: '#ffffff',
    sublabel: '#c2cfdd',
    labelHalo: 'rgba(11,15,20,0.88)',
    route: '95,208,255',
  },
  paper: {
    ground: '#f7f6f3',
    gridMinor: 'rgba(40,60,80,0.16)',
    gridMajor: 'rgba(40,60,80,0.32)',
    roomFill: 'rgba(45,90,140,0.10)',
    roomStroke: '#5c6a78',
    wallBearing: '#101418',
    wallPartition: '#48545f',
    selection: '#0a6fbd',
    selectionFill: 'rgba(10,111,189,0.22)',
    door: '#a86a00',
    window: '#0d6ea8',
    exit: '#c22a24',
    label: '#101418',
    sublabel: '#465361',
    labelHalo: 'rgba(247,246,243,0.90)',
    route: '10,111,189',
  },
};

const USES: readonly RoomUse[] = [
  'reception',
  'office',
  'open_office',
  'executive_office',
  'conference',
  'meeting',
  'laboratory',
  'server_room',
  'training',
  'lounge',
  'corridor',
  'lobby',
  'toilet',
  'store',
  'retail',
  'dining',
  'exhibition',
  'planetarium',
  'auditorium',
  'observatory',
  'control_room',
  'library',
  'plant',
  'other',
];

/**
 * 2D plan, editable.
 *
 * Canvas rather than SVG: a commercial building runs to thousands of wall and
 * opening elements, and the DOM node count becomes the bottleneck well before
 * the pixel count does.
 *
 * Editing goes through `store.applyEdit`, which mints an authorisation from the
 * user's gesture and routes it through the same validation any other change
 * faces. A refused edit surfaces its reason rather than silently doing nothing —
 * "you cannot shorten this wall past the door it carries" is information the
 * user needs, and a dead drag is not.
 */
export function PlanView({ store }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { project, floors } = store;
  const [floorIndex, setFloorIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [pointerMm, setPointerMm] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [touring, setTouring] = useState(false);
  const [tourLabel, setTourLabel] = useState('');
  const [paper, setPaper] = useState(false);
  const palette = paper ? PALETTES.paper : PALETTES.dark;

  const floor: Floor | undefined = floors[Math.min(floorIndex, floors.length - 1)];

  /**
   * The walk-through: where the marker is along the route, and how far each
   * door has swung open. Kept in a ref rather than state because it changes on
   * every animation frame, and putting it in state would re-render the whole
   * view sixty times a second to move one dot.
   */
  const tour = useMemo(() => (floor ? buildTour(floor) : null), [floor]);
  const tourRef = useRef({ distance: 0, swing: new Map<string, number>() });
  const drawRef = useRef<() => void>(() => {});

  // Kept in a ref so the pointer handlers see current values without rebinding.
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; scale: number } | null>(null);

  const transform = useMemo(() => {
    if (!floor) return null;
    const points = [
      ...floor.rooms.flatMap((r) => r.boundary),
      ...floor.walls.flatMap((w) => [w.start, w.end]),
    ];
    return points.length === 0 ? null : boundsOf(points);
  }, [floor]);

  /** Canvas pixels ⇄ model millimetres. One definition, used by draw and by hit-test. */
  const projection = useCallback(
    (width: number, height: number) => {
      if (!transform) return null;
      const pad = 70;
      const modelW = Math.max(1, transform.maxX - transform.minX);
      const modelH = Math.max(1, transform.maxY - transform.minY);
      const scale = Math.min((width - pad * 2) / modelW, (height - pad * 2) / modelH);
      const offX = (width - modelW * scale) / 2 - transform.minX * scale;
      const offY = (height + modelH * scale) / 2 + transform.minY * scale;
      return {
        scale,
        tx: (x: number) => x * scale + offX,
        ty: (y: number) => offY - y * scale,
        mx: (px: number) => (px - offX) / scale,
        my: (py: number) => (offY - py) / scale,
      };
    },
    [transform],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !floor || !transform) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      const ctx = canvas.getContext('2d');
      const p = projection(cssW, cssH);
      if (!ctx || !p) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.ground;
      ctx.fillRect(0, 0, cssW, cssH);

      const { tx, ty, scale } = p;

      // ---- Grid, drawn only when it will not alias into mush ---------------
      // Two weights. A single 1 m grid at a readable strength becomes a solid
      // field on a 60 m plan; a faint minor grid with a stronger line every 5 m
      // stays countable at any zoom, which is the point of having it at all.
      const drawGrid = (stepMm: number, colour: string, width: number) => {
        if (stepMm * scale <= 6) return;
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let x = Math.floor(transform.minX / stepMm) * stepMm; x <= transform.maxX; x += stepMm) {
          ctx.moveTo(tx(x), ty(transform.minY));
          ctx.lineTo(tx(x), ty(transform.maxY));
        }
        for (let y = Math.floor(transform.minY / stepMm) * stepMm; y <= transform.maxY; y += stepMm) {
          ctx.moveTo(tx(transform.minX), ty(y));
          ctx.lineTo(tx(transform.maxX), ty(y));
        }
        ctx.stroke();
      };
      drawGrid(1000, palette.gridMinor, 1);
      drawGrid(5000, palette.gridMajor, 1);

      // ---- Rooms ----------------------------------------------------------
      for (const room of floor.rooms) {
        ctx.beginPath();
        room.boundary.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(tx(pt.x), ty(pt.y));
          else ctx.lineTo(tx(pt.x), ty(pt.y));
        });
        ctx.closePath();
        const isSel = selection.kind === 'room' && selection.room.id === room.id;
        ctx.fillStyle = isSel ? palette.selectionFill : palette.roomFill;
        ctx.fill();
        ctx.strokeStyle = isSel ? palette.selection : palette.roomStroke;
        ctx.lineWidth = isSel ? 2.5 : 1.25;
        ctx.stroke();
      }

      // ---- Walls at true thickness ----------------------------------------
      // Walls are the drawing. They are drawn brightest of anything on it, and
      // a wall thinner than 2 px on screen is still given 2 px: at a whole-floor
      // zoom a 114 mm partition is a third of a pixel, and rounding that down is
      // how a plan ends up looking empty.
      for (const wall of floor.walls) {
        const isSel = selection.kind === 'wall' && selection.wall.id === wall.id;
        ctx.beginPath();
        ctx.moveTo(tx(wall.start.x), ty(wall.start.y));
        ctx.lineTo(tx(wall.end.x), ty(wall.end.y));
        ctx.strokeStyle = isSel
          ? palette.selection
          : wall.loadBearing
            ? palette.wallBearing
            : palette.wallPartition;
        ctx.lineWidth = Math.max(2, wall.thickness * scale);
        ctx.stroke();
      }

      // ---- Openings as gaps -----------------------------------------------
      for (const wall of floor.walls) {
        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;
        const ux = dx / len;
        const uy = dy / len;

        for (const opening of wall.openings) {
          const cx = wall.start.x + ux * opening.distanceAlongWall;
          const cy = wall.start.y + uy * opening.distanceAlongWall;
          const half = opening.width / 2;

          ctx.beginPath();
          ctx.moveTo(tx(cx - ux * half), ty(cy - uy * half));
          ctx.lineTo(tx(cx + ux * half), ty(cy + uy * half));
          ctx.strokeStyle = palette.ground;
          ctx.lineWidth = Math.max(2, wall.thickness * scale) + 2;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(tx(cx - ux * half), ty(cy - uy * half));
          ctx.lineTo(tx(cx + ux * half), ty(cy + uy * half));
          ctx.strokeStyle = opening.isEmergencyExit
            ? palette.exit
            : opening.kind === 'door'
              ? palette.door
              : palette.window;
          ctx.lineWidth = 4;
          ctx.stroke();

          // ---- Door swing --------------------------------------------------
          // The leaf and its arc, drawn the way a plan draws them. The swing
          // angle is animated as the tour passes, which is not decoration: the
          // arc is the space the door needs to open into, and seeing it sweep
          // is how you notice it is sweeping into something.
          if (opening.kind === 'door') {
            const swing = tourRef.current.swing.get(opening.id) ?? 0;
            if (swing > 0.01) {
              const hingeX = cx - ux * half;
              const hingeY = cy - uy * half;
              const base = Math.atan2(uy, ux);
              const angle = base - (Math.PI / 2) * swing;
              const leafX = hingeX + Math.cos(angle) * opening.width;
              const leafY = hingeY + Math.sin(angle) * opening.width;

              ctx.beginPath();
              ctx.moveTo(tx(hingeX), ty(hingeY));
              ctx.lineTo(tx(leafX), ty(leafY));
              ctx.strokeStyle = palette.door;
              ctx.lineWidth = 2.5;
              ctx.stroke();

              // Canvas y is inverted relative to model y, so the sweep runs the
              // other way on screen than it does in the model.
              ctx.beginPath();
              ctx.arc(
                tx(hingeX),
                ty(hingeY),
                opening.width * scale,
                -base,
                -base + (Math.PI / 2) * swing,
                false,
              );
              ctx.strokeStyle = palette.door;
              ctx.globalAlpha = 0.5;
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.globalAlpha = 1;
            }
          }
        }
      }

      // ---- Labels ---------------------------------------------------------
      // Every label is painted twice: once as a thick stroke in the ground
      // colour, once as fill. Without the halo a room name crossing a bright
      // wall is white on white, which is the one place a plan most needs to be
      // legible — the name sits at the centroid, and on a small room the
      // centroid is very close to a wall.
      const write = (text: string, x: number, y: number, colour: string) => {
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = palette.labelHalo;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = colour;
        ctx.fillText(text, x, y);
      };

      ctx.textAlign = 'center';
      for (const room of floor.rooms) {
        const c = centroid(room.boundary);
        const b = boundsOf(room.boundary);
        const areaSqft = fromMm2(polygonArea(room.boundary), 'ft2');

        // How much of the label a room can carry without it spilling over its
        // neighbours. A lift shaft is a metre and a half across: three lines of
        // text centred on it land on top of the staircase beside it and both
        // become unreadable, so a small room gets its name only, and a room too
        // small even for that gets nothing rather than a smear.
        const widthPx = (b.maxX - b.minX) * scale;
        const heightPx = (b.maxY - b.minY) * scale;
        ctx.font = '700 13px system-ui, sans-serif';
        const namePx = ctx.measureText(room.name).width;
        const room_ = widthPx > namePx + 8 && heightPx > 46 ? 'full' : heightPx > 14 ? 'name' : 'none';
        if (room_ === 'none') continue;

        write(room.name, tx(c.x), ty(c.y) - (room_ === 'full' ? 6 : -4), palette.label);
        if (room_ !== 'full') continue;

        ctx.font = '11px ui-monospace, monospace';
        write(
          `${formatLength(b.maxX - b.minX, 'ft', { imperialInches: true })} × ${formatLength(b.maxY - b.minY, 'ft', { imperialInches: true })}`,
          tx(c.x),
          ty(c.y) + 10,
          palette.sublabel,
        );
        write(`${areaSqft.toFixed(0)} sq ft`, tx(c.x), ty(c.y) + 24, palette.sublabel);
      }

      // ---- The walk -------------------------------------------------------
      if (tour && tour.path.length >= 2) {
        const walked = tourRef.current.distance;

        // The whole route, faint: the circulation spine the floor is organised
        // around, visible whether or not the tour is running.
        ctx.beginPath();
        tour.path.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(tx(pt.x), ty(pt.y));
          else ctx.lineTo(tx(pt.x), ty(pt.y));
        });
        ctx.strokeStyle = `rgba(${palette.route},0.45)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (walked > 0) {
          // The part already walked, solid.
          ctx.beginPath();
          let drawn = 0;
          ctx.moveTo(tx(tour.path[0]!.x), ty(tour.path[0]!.y));
          for (let i = 0; i < tour.path.length - 1 && drawn < walked; i++) {
            const a = tour.path[i]!;
            const b = tour.path[i + 1]!;
            const seg = Math.hypot(b.x - a.x, b.y - a.y);
            const t = Math.min(1, (walked - drawn) / (seg || 1));
            ctx.lineTo(tx(a.x + (b.x - a.x) * t), ty(a.y + (b.y - a.y) * t));
            drawn += seg;
          }
          ctx.strokeStyle = `rgba(${palette.route},1)`;
          ctx.lineWidth = 3.5;
          ctx.stroke();

          // Where the walker is now.
          const here = tourPointAt(tour, walked);
          ctx.beginPath();
          ctx.arc(tx(here.at.x), ty(here.at.y), 7, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${palette.route})`;
          ctx.fill();
          ctx.strokeStyle = palette.ground;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    };

    drawRef.current = draw;
    draw();
    registerCanvas('plan', canvas);
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => {
      // Cache the last frame before unmount: the report embeds an image of the
      // plan, and it must not depend on this tab being open.
      cacheFrame('plan');
      registerCanvas('plan', null);
      observer.disconnect();
    };
  }, [floor, transform, selection, projection, tour, palette]);

  /**
   * Walk the route.
   *
   * Real walking pace — 1.4 m/s is the figure circulation and escape-time
   * calculations use — so the time the tour takes is the time the walk takes.
   * A door opens as the walker comes within 3 m of it and closes behind them,
   * which is what makes the swing arcs readable one at a time instead of the
   * whole floor blinking at once.
   */
  useEffect(() => {
    if (!touring || !tour || tour.totalLength <= 0) return;

    const PACE_MM_PER_MS = 1.4; // 1.4 m/s
    const OPEN_WITHIN_MM = 3000;
    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(now - last, 100); // a backgrounded tab must not leap
      last = now;

      const state = tourRef.current;
      state.distance += dt * PACE_MM_PER_MS;
      if (state.distance > tour.totalLength) state.distance = 0;

      if (floor) {
        const here = tourPointAt(tour, state.distance);
        for (const wall of floor.walls) {
          const dx = wall.end.x - wall.start.x;
          const dy = wall.end.y - wall.start.y;
          const len = Math.hypot(dx, dy) || 1;
          for (const opening of wall.openings) {
            if (opening.kind !== 'door') continue;
            const at = {
              x: wall.start.x + (dx / len) * opening.distanceAlongWall,
              y: wall.start.y + (dy / len) * opening.distanceAlongWall,
            };
            const gap = Math.hypot(at.x - here.at.x, at.y - here.at.y);
            const target = gap < OPEN_WITHIN_MM ? 1 : 0;
            const current = state.swing.get(opening.id) ?? 0;
            // Ease towards the target so the leaf swings rather than snaps.
            state.swing.set(opening.id, current + (target - current) * Math.min(1, dt / 220));
          }
        }

        const reached = [...tour.stops].filter((s) => s.distanceAlong <= state.distance).pop();
        setTourLabel(reached ? reached.name : 'Setting off');
      }

      drawRef.current();
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [touring, tour, floor]);

  /** Leaving the tour must leave the drawing static, not frozen mid-swing. */
  const stopTour = useCallback(() => {
    setTouring(false);
    tourRef.current = { distance: 0, swing: new Map() };
    setTourLabel('');
    drawRef.current();
  }, []);

  /** Hit-test: walls take priority over rooms, since they are the thinner target. */
  const pick = useCallback(
    (mx: number, my: number): Selection => {
      if (!floor) return { kind: 'none' };
      for (const wall of floor.walls) {
        const d = distancePointToSegment({ x: mx, y: my }, wall.start, wall.end);
        if (d <= wall.thickness / 2 + 60) return { kind: 'wall', wall };
      }
      const room = floor.rooms.find((r) => pointInPolygon({ x: mx, y: my }, r.boundary));
      return room ? { kind: 'room', room } : { kind: 'none' };
    },
    [floor],
  );

  const toModel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const p = projection(rect.width, rect.height);
      if (!p) return null;
      return {
        x: p.mx(event.clientX - rect.left),
        y: p.my(event.clientY - rect.top),
        scale: p.scale,
      };
    },
    [projection],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const model = toModel(event);
    if (!model || !floor) return;
    const hit = pick(model.x, model.y);
    setSelection(hit);
    setError('');

    if (hit.kind !== 'none') {
      dragRef.current = { active: false, lastX: model.x, lastY: model.y, scale: model.scale };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const model = toModel(event);
    if (!model) return;
    setPointerMm({ x: model.x, y: model.y });

    const drag = dragRef.current;
    if (!drag || !floor) return;

    const dx = model.x - drag.lastX;
    const dy = model.y - drag.lastY;
    // Ignore sub-pixel jitter so a click does not register as a 0.3 mm move.
    if (Math.abs(dx) < SNAP_MM && Math.abs(dy) < SNAP_MM) return;

    const snapped = {
      x: Math.round(dx / SNAP_MM) * SNAP_MM,
      y: Math.round(dy / SNAP_MM) * SNAP_MM,
    };
    if (snapped.x === 0 && snapped.y === 0) return;

    drag.active = true;
    setDragging(true);

    const reason = store.applyEdit((arch, auth) => {
      if (selection.kind === 'room') {
        return moveRoom(arch, floor.id, selection.room.id, snapped.x, snapped.y, auth);
      }
      if (selection.kind === 'wall') {
        return moveWall(arch, floor.id, selection.wall.id, snapped.x, snapped.y, auth);
      }
      return { ok: false, reason: 'Nothing selected.' };
    });

    if (reason) {
      setError(reason);
      dragRef.current = null;
      setDragging(false);
      return;
    }

    drag.lastX += snapped.x;
    drag.lastY += snapped.y;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  // Keep the selection pointing at the live object after an edit.
  useEffect(() => {
    if (!floor) return;
    if (selection.kind === 'room') {
      const live = floor.rooms.find((r) => r.id === selection.room.id);
      if (live && live !== selection.room) setSelection({ kind: 'room', room: live });
      if (!live) setSelection({ kind: 'none' });
    } else if (selection.kind === 'wall') {
      const live = floor.walls.find((w) => w.id === selection.wall.id);
      if (live && live !== selection.wall) setSelection({ kind: 'wall', wall: live });
      if (!live) setSelection({ kind: 'none' });
    }
  }, [floor, selection]);

  if (!project || !floor) return <div className="list-empty">No project open.</div>;

  return (
    <div className="viewport" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: dragging ? 'grabbing' : selection.kind === 'none' ? 'default' : 'grab' }}
      />

      <div className="overlay tl" style={{ maxWidth: 250 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{project.name}</div>
        <label>Floor — one click</label>
        <div className="floor-buttons">
          {[...floors]
            .map((f, i) => ({ f, i }))
            .reverse()
            .map(({ f, i }) => (
              <button
                key={f.id}
                className={i === floorIndex ? 'primary' : 'ghost'}
                onClick={() => {
                  setFloorIndex(i);
                  setSelection({ kind: 'none' });
                }}
                title={f.purpose ?? f.name}
              >
                {f.level === 0 ? 'G' : f.level > 0 ? String(f.level) : `B${Math.abs(f.level)}`}
              </button>
            ))}
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {floor.name}
        </div>

        <label style={{ marginTop: 10 }}>Contrast</label>
        <div className="row">
          <button
            className={paper ? 'ghost' : 'primary'}
            onClick={() => setPaper(false)}
            title="Bright line work on a dark ground"
          >
            Dark
          </button>
          <button
            className={paper ? 'primary' : 'ghost'}
            onClick={() => setPaper(true)}
            title="Black line work on white, the way the sheet is printed — the highest contrast available"
          >
            Paper
          </button>
        </div>

        <label style={{ marginTop: 10 }}>Circulation</label>
        <div className="row">
          <button
            className={touring ? 'primary' : 'ghost'}
            onClick={() => (touring ? stopTour() : setTouring(true))}
            disabled={!tour || tour.totalLength <= 0}
            title={
              tour && tour.totalLength > 0
                ? 'Walk the corridor at 1.4 m/s, opening each door on the way'
                : 'This floor has no circulation route to walk'
            }
          >
            {touring ? 'Stop the walk' : 'Walk the floor'}
          </button>
          {tour && tour.totalLength > 0 && (
            <span className="small muted">
              {(tour.totalLength / 1000).toFixed(0)} m · {tour.stops.length} rooms
            </span>
          )}
        </div>
        {touring && tourLabel && (
          <div className="small" style={{ marginTop: 4, color: 'var(--accent)' }}>
            Passing {tourLabel}
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={store.undo} disabled={!store.canUndo} title={store.undoLabel ?? ''}>
            Undo
          </button>
          <button className="ghost" onClick={store.redo} disabled={!store.canRedo}>
            Redo
          </button>
        </div>

        <label style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={store.reviewAcknowledged}
            onChange={(e) => store.acknowledgeReview(e.target.checked)}
            style={{ width: 'auto', marginTop: 2 }}
          />
          <span className="small">
            I understand plan edits need review by a qualified architect or engineer.
          </span>
        </label>

        <div className="small muted" style={{ marginTop: 8 }}>
          {store.reviewAcknowledged
            ? 'Drag a room or wall to move it. Snaps to 3 in.'
            : 'Editing is locked until the notice above is acknowledged.'}
        </div>
        {pointerMm && (
          <div className="small mono muted" style={{ marginTop: 6 }}>
            {formatLength(pointerMm.x, 'ft')} , {formatLength(pointerMm.y, 'ft')}
          </div>
        )}
      </div>

      <div className="overlay bl">
        <div className="small">
          <span style={{ color: palette.door }}>▬</span> door &nbsp;
          <span style={{ color: palette.window }}>▬</span> window &nbsp;
          <span style={{ color: palette.exit }}>▬</span> emergency exit
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          Walls at true thickness. Grid = 1 m.
        </div>
        {error && (
          <div className="small" style={{ color: 'var(--err)', marginTop: 6, maxWidth: 380 }}>
            {error}
          </div>
        )}
      </div>

      {selection.kind === 'room' && (
        <RoomInspector store={store} floor={floor} room={selection.room} onError={setError} />
      )}
      {selection.kind === 'wall' && (
        <WallInspector store={store} floor={floor} wall={selection.wall} onError={setError} />
      )}
    </div>
  );
}

function RoomInspector({
  store,
  floor,
  room,
  onError,
}: {
  store: ProjectStore;
  floor: Floor;
  room: Room;
  onError: (msg: string) => void;
}): JSX.Element {
  const bounds = boundsOf(room.boundary);
  const areaSqft = fromMm2(polygonArea(room.boundary), 'ft2');
  const capacity = estimateCapacity(room, areaSqft);

  const [width, setWidth] = useState(formatLength(bounds.maxX - bounds.minX, 'ft'));
  const [depth, setDepth] = useState(formatLength(bounds.maxY - bounds.minY, 'ft'));

  useEffect(() => {
    setWidth(formatLength(bounds.maxX - bounds.minX, 'ft'));
    setDepth(formatLength(bounds.maxY - bounds.minY, 'ft'));
  }, [room.id, bounds.maxX, bounds.minX, bounds.maxY, bounds.minY]);

  const applyResize = () => {
    const w = parseLength(width, 'ft');
    const d = parseLength(depth, 'ft');
    if (w === null || d === null) {
      onError('Could not read those dimensions. Try 20, 20ft, 20\' or 6096mm.');
      return;
    }
    const reason = store.applyEdit((arch, auth) => resizeRoom(arch, floor.id, room.id, w, d, auth));
    onError(reason ?? '');
  };

  return (
    <div className="overlay tr" style={{ maxWidth: 300, maxHeight: '84%', overflow: 'auto' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{room.name}</div>

      <label htmlFor="ri-name">Name</label>
      <input
        id="ri-name"
        value={room.name}
        onChange={(e) => {
          const reason = store.applyEdit((arch) =>
            setRoomProperties(arch, floor.id, room.id, { name: e.target.value }),
          );
          onError(reason ?? '');
        }}
      />

      <label htmlFor="ri-use" style={{ marginTop: 8 }}>
        Use
      </label>
      <select
        id="ri-use"
        value={room.use}
        onChange={(e) => {
          const reason = store.applyEdit((arch) =>
            setRoomProperties(arch, floor.id, room.id, { use: e.target.value as RoomUse }),
          );
          onError(reason ?? '');
        }}
      >
        {USES.map((u) => (
          <option key={u} value={u}>
            {u.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

      <div className="grid cols-2" style={{ marginTop: 8 }}>
        <div>
          <label htmlFor="ri-w">Width</label>
          <input id="ri-w" value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ri-d">Depth</label>
          <input id="ri-d" value={depth} onChange={(e) => setDepth(e.target.value)} />
        </div>
      </div>
      <button className="primary" onClick={applyResize} style={{ marginTop: 8, width: '100%' }}>
        Resize room
      </button>

      <div className="small muted" style={{ marginTop: 10 }}>
        {areaSqft.toFixed(0)} sq ft · {formatLength(room.clearHeight, 'ft', { imperialInches: true })} clear ·
        dimensions {room.provenance.confidence}
      </div>

      <div className="small" style={{ fontWeight: 600, marginTop: 10, marginBottom: 4 }}>
        What fits here
      </div>
      {capacity.suggestions.map((s) => (
        <div key={s.what} className="small" style={{ marginBottom: 4 }}>
          <span className="mono">{s.count}</span> × {s.what}
          <div className="muted" style={{ fontSize: 11 }}>
            {s.basis}
          </div>
        </div>
      ))}
    </div>
  );
}

function WallInspector({
  store,
  floor,
  wall,
  onError,
}: {
  store: ProjectStore;
  floor: Floor;
  wall: Wall;
  onError: (msg: string) => void;
}): JSX.Element {
  const [thickness, setThickness] = useState(String((wall.thickness / 25.4).toFixed(1)));
  useEffect(() => setThickness(String((wall.thickness / 25.4).toFixed(1))), [wall.id, wall.thickness]);

  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

  const addDoor = (kind: 'door' | 'window') => {
    const reason = store.applyEdit((arch, auth) =>
      addOpening(
        arch,
        floor.id,
        wall.id,
        kind === 'door'
          ? { kind: 'door', distanceAlongWallMm: length / 2, widthMm: 900, heightMm: 2100, sillHeightMm: 0 }
          : {
              kind: 'window',
              distanceAlongWallMm: length / 2,
              widthMm: 1500,
              heightMm: 1200,
              sillHeightMm: 900,
            },
        auth,
      ),
    );
    onError(reason ?? '');
  };

  return (
    <div className="overlay tr" style={{ maxWidth: 300, maxHeight: '84%', overflow: 'auto' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Wall <span className="mono small muted">{wall.id.slice(-6)}</span>
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>
        {formatLength(length, 'ft', { imperialInches: true })} long · {wall.function.replace(/_/g, ' ')}
        {wall.loadBearing ? ' · load-bearing' : ''}
      </div>

      <label htmlFor="wi-t">Thickness (inches)</label>
      <div className="row">
        <input id="wi-t" value={thickness} onChange={(e) => setThickness(e.target.value)} />
        <button
          className="ghost"
          onClick={() => {
            const inches = Number(thickness);
            if (!Number.isFinite(inches) || inches <= 0) {
              onError('Enter a thickness in inches.');
              return;
            }
            const reason = store.applyEdit((arch, auth) =>
              setWallProperties(arch, floor.id, wall.id, { thicknessMm: inches * 25.4 }, auth),
            );
            onError(reason ?? '');
          }}
        >
          Set
        </button>
      </div>

      <label style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={wall.loadBearing}
          onChange={(e) => {
            const reason = store.applyEdit((arch, auth) =>
              setWallProperties(arch, floor.id, wall.id, { loadBearing: e.target.checked }, auth),
            );
            onError(reason ?? '');
          }}
          style={{ width: 'auto' }}
        />
        <span className="small">Load-bearing</span>
      </label>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={() => addDoor('door')}>
          Add door
        </button>
        <button className="ghost" onClick={() => addDoor('window')}>
          Add window
        </button>
      </div>

      <button
        className="ghost"
        style={{ marginTop: 8, width: '100%' }}
        onClick={() => {
          const reason = store.applyEdit((arch, auth) => deleteWall(arch, floor.id, wall.id, auth));
          onError(reason ?? '');
        }}
      >
        Delete wall
      </button>

      {wall.openings.length > 0 && (
        <>
          <div className="small" style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
            Openings
          </div>
          {wall.openings.map((o) => (
            <div key={o.id} className="small" style={{ marginBottom: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {o.kind}
                  {o.isEmergencyExit && <span className="badge low" style={{ marginLeft: 4 }}>EXIT</span>}
                </span>
                <button
                  className="ghost"
                  style={{ padding: '2px 8px' }}
                  onClick={() => {
                    const reason = store.applyEdit((arch, auth) =>
                      deleteOpening(arch, floor.id, wall.id, o.id as OpeningId, auth),
                    );
                    onError(reason ?? '');
                  }}
                >
                  Remove
                </button>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {formatLength(o.width, 'ft')} wide at {formatLength(o.distanceAlongWall, 'ft')} along
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export type { WallId };
