/**
 * View capture registry.
 *
 * The report embeds images of the plan and the 3D model. Those live inside
 * canvases owned by views that may not be mounted when the report is built, so
 * a registry is used rather than a ref passed down through props.
 *
 * Each view registers its canvas while mounted and the last frame is cached on
 * unmount. That is what lets a user visit the 3D view once, move to the report
 * tab, and still get a 3D image — without keeping a WebGL context alive on a
 * tab nobody is looking at.
 */

export type CaptureId = 'plan' | 'model';

interface Entry {
  readonly caption: string;
  canvas: HTMLCanvasElement | null;
  /** Last frame captured before the view unmounted. */
  cached: string | null;
}

const registry = new Map<CaptureId, Entry>([
  ['plan', { caption: '2D floor plan', canvas: null, cached: null }],
  ['model', { caption: '3D model', canvas: null, cached: null }],
]);

export function registerCanvas(id: CaptureId, canvas: HTMLCanvasElement | null): void {
  const entry = registry.get(id);
  if (!entry) return;
  entry.canvas = canvas;
}

/**
 * Cache the current frame. Call before a view unmounts.
 *
 * A WebGL canvas returns a blank image once its context is lost, so the capture
 * has to happen while the view is still alive.
 */
export function cacheFrame(id: CaptureId): void {
  const entry = registry.get(id);
  if (!entry?.canvas) return;
  try {
    entry.cached = entry.canvas.toDataURL('image/png');
  } catch {
    // A tainted or zero-size canvas cannot be read. A missing image is a
    // cosmetic loss in the report; throwing here would break the export.
  }
}

export async function captureAll(): Promise<Array<{ caption: string; dataUri: string }>> {
  const images: Array<{ caption: string; dataUri: string }> = [];
  for (const entry of registry.values()) {
    let dataUri = entry.cached;
    if (entry.canvas) {
      try {
        dataUri = entry.canvas.toDataURL('image/png');
        entry.cached = dataUri;
      } catch {
        /* fall back to the cached frame */
      }
    }
    if (dataUri && dataUri.length > 512) {
      images.push({ caption: entry.caption, dataUri });
    }
  }
  return images;
}

export function hasCapture(id: CaptureId): boolean {
  const entry = registry.get(id);
  return Boolean(entry?.cached || entry?.canvas);
}
