import { useEffect, useMemo, useRef, useState } from 'react';
import {
  allFloors,
  boundsOf,
  centroid,
  estimateCapacity,
  formatLength,
  fromMm2,
  polygonArea,
  pointInPolygon,
  type Floor,
  type Project,
  type Room,
} from '@adp/core';

interface Props {
  readonly project: Project;
}

/**
 * 2D plan.
 *
 * Drawn on a canvas rather than as SVG: a commercial building runs to thousands
 * of wall and opening elements, and the DOM node count becomes the bottleneck
 * well before the pixel count does.
 *
 * The view draws from the architecture layer only. Nothing here can write back
 * to it, which is why this file needs no integrity guard.
 */
export function PlanView({ project }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const floors = useMemo(() => allFloors(project), [project]);
  const [floorIndex, setFloorIndex] = useState(0);
  const [selected, setSelected] = useState<Room | null>(null);
  const [pointerMm, setPointerMm] = useState<{ x: number; y: number } | null>(null);

  const floor: Floor | undefined = floors[Math.min(floorIndex, floors.length - 1)];

  // Fit transform: model millimetres to canvas pixels.
  const transform = useMemo(() => {
    if (!floor) return null;
    const points = [
      ...floor.rooms.flatMap((r) => r.boundary),
      ...floor.walls.flatMap((w) => [w.start, w.end]),
    ];
    if (points.length === 0) return null;
    return boundsOf(points);
  }, [floor]);

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
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#0d1116';
      ctx.fillRect(0, 0, cssW, cssH);

      const pad = 60;
      const modelW = transform.maxX - transform.minX;
      const modelH = transform.maxY - transform.minY;
      const scale = Math.min((cssW - pad * 2) / modelW, (cssH - pad * 2) / modelH);
      const offX = (cssW - modelW * scale) / 2 - transform.minX * scale;
      // Y is flipped: plan coordinates run north-up, canvas runs down.
      const offY = (cssH + modelH * scale) / 2 + transform.minY * scale;

      const tx = (x: number) => x * scale + offX;
      const ty = (y: number) => offY - y * scale;

      // ---- Grid at 1 metre, drawn only when it will not alias into mush ----
      const gridMm = 1000;
      if (gridMm * scale > 6) {
        ctx.strokeStyle = '#1a2029';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.floor(transform.minX / gridMm) * gridMm; x <= transform.maxX; x += gridMm) {
          ctx.moveTo(tx(x), ty(transform.minY));
          ctx.lineTo(tx(x), ty(transform.maxY));
        }
        for (let y = Math.floor(transform.minY / gridMm) * gridMm; y <= transform.maxY; y += gridMm) {
          ctx.moveTo(tx(transform.minX), ty(y));
          ctx.lineTo(tx(transform.maxX), ty(y));
        }
        ctx.stroke();
      }

      // ---- Room fills ----
      for (const room of floor.rooms) {
        ctx.beginPath();
        room.boundary.forEach((p, i) => {
          if (i === 0) ctx.moveTo(tx(p.x), ty(p.y));
          else ctx.lineTo(tx(p.x), ty(p.y));
        });
        ctx.closePath();
        const isSel = selected?.id === room.id;
        ctx.fillStyle = isSel ? 'rgba(74,163,223,0.20)' : 'rgba(148,168,190,0.07)';
        ctx.fill();
        ctx.strokeStyle = isSel ? '#4aa3df' : '#3a4655';
        ctx.lineWidth = isSel ? 2 : 1;
        ctx.stroke();
      }

      // ---- Walls, drawn at true thickness ----
      for (const wall of floor.walls) {
        ctx.beginPath();
        ctx.moveTo(tx(wall.start.x), ty(wall.start.y));
        ctx.lineTo(tx(wall.end.x), ty(wall.end.y));
        ctx.strokeStyle = wall.loadBearing ? '#8fa2b8' : '#5d6b7d';
        ctx.lineWidth = Math.max(1.5, wall.thickness * scale);
        ctx.stroke();
      }

      // ---- Openings, as gaps in the wall run ----
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
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }

      // ---- Room labels and dimension strings ----
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
        const w = formatLength(b.maxX - b.minX, 'ft', { imperialInches: true });
        const d = formatLength(b.maxY - b.minY, 'ft', { imperialInches: true });
        ctx.fillText(`${w} × ${d}`, tx(c.x), ty(c.y) + 10);
        ctx.fillText(`${areaSqft.toFixed(0)} sq ft`, tx(c.x), ty(c.y) + 24);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [floor, transform, selected]);

  // Click-to-select, converting canvas pixels back to model millimetres.
  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !floor || !transform) return;

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    const pad = 60;
    const modelW = transform.maxX - transform.minX;
    const modelH = transform.maxY - transform.minY;
    const scale = Math.min((rect.width - pad * 2) / modelW, (rect.height - pad * 2) / modelH);
    const offX = (rect.width - modelW * scale) / 2 - transform.minX * scale;
    const offY = (rect.height + modelH * scale) / 2 + transform.minY * scale;

    const mx = (px - offX) / scale;
    const my = (offY - py) / scale;
    setPointerMm({ x: mx, y: my });
    setSelected(floor.rooms.find((r) => pointInPolygon({ x: mx, y: my }, r.boundary)) ?? null);
  };

  const capacity = selected
    ? estimateCapacity(selected, fromMm2(polygonArea(selected.boundary), 'ft2'))
    : null;

  return (
    <div className="viewport" ref={wrapRef}>
      <canvas ref={canvasRef} onClick={onClick} />

      <div className="overlay tl">
        <div style={{ marginBottom: 8, fontWeight: 600 }}>{project.name}</div>
        <label htmlFor="floor-select">Floor</label>
        <select
          id="floor-select"
          value={floorIndex}
          onChange={(e) => {
            setFloorIndex(Number(e.target.value));
            setSelected(null);
          }}
        >
          {floors.map((f, i) => (
            <option key={f.id} value={i}>
              {f.name}
            </option>
          ))}
        </select>
        <div className="small muted" style={{ marginTop: 8 }}>
          Click a room to select it.
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
          Walls drawn at true thickness. Grid = 1 m.
        </div>
      </div>

      {selected && capacity && (
        <div className="overlay tr">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{selected.name}</div>
          <div className="small muted" style={{ marginBottom: 8 }}>
            {selected.use.replace(/_/g, ' ')} · {capacity.areaSqft.toFixed(0)} sq ft ·{' '}
            {formatLength(selected.clearHeight, 'ft', { imperialInches: true })} clear
          </div>
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>
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
          <div className="small muted" style={{ marginTop: 8, fontSize: 11 }}>
            Dimension confidence: {selected.provenance.confidence}
          </div>
        </div>
      )}
    </div>
  );
}
