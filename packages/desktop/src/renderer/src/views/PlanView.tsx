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

  const floor: Floor | undefined = floors[Math.min(floorIndex, floors.length - 1)];

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
      ctx.fillStyle = '#0d1116';
      ctx.fillRect(0, 0, cssW, cssH);

      const { tx, ty, scale } = p;

      // ---- Grid at 1 m, drawn only when it will not alias into mush --------
      if (1000 * scale > 6) {
        ctx.strokeStyle = '#1a2029';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.floor(transform.minX / 1000) * 1000; x <= transform.maxX; x += 1000) {
          ctx.moveTo(tx(x), ty(transform.minY));
          ctx.lineTo(tx(x), ty(transform.maxY));
        }
        for (let y = Math.floor(transform.minY / 1000) * 1000; y <= transform.maxY; y += 1000) {
          ctx.moveTo(tx(transform.minX), ty(y));
          ctx.lineTo(tx(transform.maxX), ty(y));
        }
        ctx.stroke();
      }

      // ---- Rooms ----------------------------------------------------------
      for (const room of floor.rooms) {
        ctx.beginPath();
        room.boundary.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(tx(pt.x), ty(pt.y));
          else ctx.lineTo(tx(pt.x), ty(pt.y));
        });
        ctx.closePath();
        const isSel = selection.kind === 'room' && selection.room.id === room.id;
        ctx.fillStyle = isSel ? 'rgba(74,163,223,0.22)' : 'rgba(148,168,190,0.07)';
        ctx.fill();
        ctx.strokeStyle = isSel ? '#4aa3df' : '#3a4655';
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.stroke();
      }

      // ---- Walls at true thickness ----------------------------------------
      for (const wall of floor.walls) {
        const isSel = selection.kind === 'wall' && selection.wall.id === wall.id;
        ctx.beginPath();
        ctx.moveTo(tx(wall.start.x), ty(wall.start.y));
        ctx.lineTo(tx(wall.end.x), ty(wall.end.y));
        ctx.strokeStyle = isSel ? '#4aa3df' : wall.loadBearing ? '#8fa2b8' : '#5d6b7d';
        ctx.lineWidth = Math.max(1.5, wall.thickness * scale);
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
          ctx.strokeStyle = '#0d1116';
          ctx.lineWidth = Math.max(1.5, wall.thickness * scale) + 1;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(tx(cx - ux * half), ty(cy - uy * half));
          ctx.lineTo(tx(cx + ux * half), ty(cy + uy * half));
          ctx.strokeStyle = opening.isEmergencyExit
            ? '#e0625f'
            : opening.kind === 'door'
              ? '#d9a441'
              : '#5fb0e6';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // ---- Labels ---------------------------------------------------------
      ctx.textAlign = 'center';
      for (const room of floor.rooms) {
        const c = centroid(room.boundary);
        const b = boundsOf(room.boundary);
        const areaSqft = fromMm2(polygonArea(room.boundary), 'ft2');

        ctx.fillStyle = '#e6eaf0';
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.fillText(room.name, tx(c.x), ty(c.y) - 6);

        ctx.fillStyle = '#97a3b4';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(
          `${formatLength(b.maxX - b.minX, 'ft', { imperialInches: true })} × ${formatLength(b.maxY - b.minY, 'ft', { imperialInches: true })}`,
          tx(c.x),
          ty(c.y) + 10,
        );
        ctx.fillText(`${areaSqft.toFixed(0)} sq ft`, tx(c.x), ty(c.y) + 24);
      }
    };

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
  }, [floor, transform, selection, projection]);

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
        <label htmlFor="floor-select">Floor</label>
        <select
          id="floor-select"
          value={floorIndex}
          onChange={(e) => {
            setFloorIndex(Number(e.target.value));
            setSelection({ kind: 'none' });
          }}
        >
          {floors.map((f, i) => (
            <option key={f.id} value={i}>
              {f.name}
            </option>
          ))}
        </select>

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
          <span style={{ color: '#d9a441' }}>▬</span> door &nbsp;
          <span style={{ color: '#5fb0e6' }}>▬</span> window &nbsp;
          <span style={{ color: '#e0625f' }}>▬</span> emergency exit
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
