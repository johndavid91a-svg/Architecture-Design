import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrawingSheetContent, DrawingSheetSummary } from '../../../shared/ipc.js';

interface Props {
  /** The file the project was imported from. Empty when it was not imported. */
  readonly path: string;
}

/**
 * The architect's drawings, as sheets.
 *
 * This tab sits before the 2D plan for a reason: it is the document the user
 * recognises. The plan and the model are this app's *reading* of it, and being
 * able to put the two side by side is how anyone checks a reading.
 *
 * It draws the same line work the importer reads, rather than rendering the PDF
 * with a viewer. That is deliberate, and the more useful of the two: a sheet
 * that looks sparse here is a sheet the importer got little from, which explains
 * a thin floor far better than a number in an issue list can.
 */
export function DrawingsView({ path }: Props): JSX.Element {
  const [sheets, setSheets] = useState<DrawingSheetSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [content, setContent] = useState<DrawingSheetContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showText, setShowText] = useState(true);
  const [paper, setPaper] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setBusy(true);
    setError('');
    window.desktop
      .drawingSheets(path)
      .then((list) => {
        if (!live) return;
        setSheets(list);
        // Open a floor plan first: it is what anyone came to look at.
        const first = list.find((s) => s.kind === 'floor_plan') ?? list[0];
        setSelected(first?.pageNumber ?? null);
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    if (!path || selected === null) return;
    let live = true;
    setBusy(true);
    window.desktop
      .drawingSheet(path, selected)
      .then((c) => live && setContent(c))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [path, selected]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !content) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ink = paper ? '#101418' : '#e8eef5';
    ctx.fillStyle = paper ? '#f7f6f3' : '#0b0f14';
    ctx.fillRect(0, 0, cssW, cssH);

    const e = content.extent;
    const w = Math.max(1, e.maxX - e.minX);
    const h = Math.max(1, e.maxY - e.minY);
    const pad = 24;
    const k = Math.min((cssW - pad * 2) / w, (cssH - pad * 2) / h);
    const ox = (cssW - w * k) / 2;
    const oy = (cssH - h * k) / 2;
    // A PDF's y runs up the page and a canvas's runs down it.
    const X = (x: number) => ox + (x - e.minX) * k;
    const Y = (y: number) => oy + (e.maxY - y) * k;

    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of content.lines) {
      ctx.moveTo(X(x1), Y(y1));
      ctx.lineTo(X(x2), Y(y2));
    }
    ctx.stroke();

    if (!showText) return;
    ctx.fillStyle = paper ? '#0a3d6b' : '#7fc4ff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const t of content.texts) {
      // Text is drawn at the size it sits on the sheet, so it thins out with the
      // drawing instead of turning into a solid block of labels when zoomed out.
      const size = Math.max(4, (t.h || 8) * k);
      if (size < 5) continue;
      ctx.font = `${size.toFixed(1)}px system-ui, sans-serif`;
      ctx.fillText(t.t, X(t.x), Y(t.y));
    }
  }, [content, paper, showText]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  const grouped = useMemo(() => {
    const byKind = new Map<string, DrawingSheetSummary[]>();
    for (const sheet of sheets ?? []) {
      const list = byKind.get(sheet.kind);
      if (list) list.push(sheet);
      else byKind.set(sheet.kind, [sheet]);
    }
    // Floor plans first — they are what the model is built from.
    const order = ['floor_plan', 'elevation', 'section', 'area_plan', 'structural_plan', 'schedule', 'detail'];
    return [...byKind.entries()].sort(
      (a, b) => (order.indexOf(a[0]) + 100) % 100 || 0 - ((order.indexOf(b[0]) + 100) % 100),
    );
  }, [sheets]);

  if (!path) {
    return (
      <div className="list-empty">
        No drawing is attached to this project. Create a project from a PDF, DXF or IFC on the
        Project tab and its sheets appear here.
      </div>
    );
  }

  return (
    <div className="viewport" ref={wrapRef}>
      <canvas ref={canvasRef} />

      <div className="overlay tl" style={{ maxWidth: 290, maxHeight: '86%', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          {path.split(/[\\/]/).pop()}
        </div>
        <div className="small muted" style={{ marginBottom: 8 }}>
          {sheets === null
            ? 'Reading the sheets…'
            : `${sheets.length} sheet(s). This is the line work the app read — what you see here is
               what it saw.`}
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <button className={paper ? 'primary' : 'ghost'} onClick={() => setPaper(true)}>
            Paper
          </button>
          <button className={paper ? 'ghost' : 'primary'} onClick={() => setPaper(false)}>
            Dark
          </button>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={showText}
            onChange={(event) => setShowText(event.target.checked)}
            style={{ width: 'auto' }}
          />
          <span className="small">Show the text on the sheet</span>
        </label>

        {grouped.map(([kind, list]) => (
          <div key={kind} style={{ marginBottom: 8 }}>
            <label>{kind.replace(/_/g, ' ')}</label>
            {list.map((sheet) => (
              <button
                key={sheet.pageNumber}
                className={sheet.pageNumber === selected ? 'primary' : 'ghost'}
                style={{ width: '100%', textAlign: 'left', marginBottom: 2, padding: '3px 8px' }}
                onClick={() => setSelected(sheet.pageNumber)}
                title={`${sheet.segmentCount} line(s)${sheet.toMmScale > 0 ? '' : ' — no usable scale'}`}
              >
                <span className="small mono muted">{String(sheet.pageNumber).padStart(2, '0')}</span>{' '}
                <span className="small">{sheet.storey ?? sheet.title.slice(0, 34)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="overlay bl" style={{ maxWidth: 440 }}>
        {busy && <div className="small">Reading…</div>}
        {error && <div className="small" style={{ color: 'var(--err)' }}>{error}</div>}
        {content && !busy && (
          <>
            <div className="small" style={{ fontWeight: 600 }}>{content.title}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {content.lines.length.toLocaleString()} line(s), {content.texts.length} text run(s).{' '}
              {content.toMmScale > 0
                ? `Scale read from the sheet: ${content.toMmScale.toFixed(3)} mm per point.`
                : 'This sheet states no usable scale, so nothing can be measured from it.'}
            </div>
            {content.error && (
              <div className="small" style={{ color: 'var(--err)', marginTop: 4 }}>
                {content.error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
