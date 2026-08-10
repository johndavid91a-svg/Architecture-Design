import { describe, expect, it } from 'vitest';
import { extractPdfLineWork } from './pdf.js';

/**
 * Build a minimal single-page vector PDF containing the given content stream.
 *
 * Written by hand rather than committed as a binary fixture, so what the
 * extractor is being fed is visible in the test: a byte-level fixture that
 * nobody can read is a fixture nobody can correct when it goes wrong. The xref
 * offsets are computed as the file is assembled, because a PDF with a wrong
 * xref table is exactly the kind of "corrupt file" the importer is supposed to
 * report on, and this fixture must not be one by accident.
 */
function buildPdf(content: string, mediaBox = '[0 0 595 842]'): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox${mediaBox}/Contents 4 0 R/Resources<<>>>>`,
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];

  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body, 'latin1'));
}

/** A 300 x 400 pt rectangle drawn as four separate strokes. */
const RECTANGLE = [
  '1 w',
  '100 100 m 400 100 l S',
  '400 100 m 400 500 l S',
  '400 500 m 100 500 l S',
  '100 500 m 100 100 l S',
].join('\n');

describe('PDF line-work extraction', () => {
  it('reads vector line work from a page', async () => {
    // The regression this file exists for: `destroy()` was called on the
    // document proxy, where pdfjs does not define it. The call threw from a
    // `finally`, so every successful extraction was replaced by a TypeError and
    // PDF import could not work on any platform. No test touched this module,
    // which is why a completely dead feature looked healthy.
    const result = await extractPdfLineWork(buildPdf(RECTANGLE));

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.segments.length).toBeGreaterThanOrEqual(4);
  });

  it('reports the page extent it actually read', async () => {
    const result = await extractPdfLineWork(buildPdf(RECTANGLE));
    const { extent } = result.pages[0]!;
    expect(extent.maxX - extent.minX).toBeGreaterThan(250);
    expect(extent.maxY - extent.minY).toBeGreaterThan(350);
  });

  it('refuses to measure anything until the scale is known', async () => {
    // A PDF page records marks in points and says nothing about how big the
    // building is. Guessing produces a complete, plausible model of the wrong
    // building, and nothing downstream can detect that.
    const result = await extractPdfLineWork(buildPdf(RECTANGLE));
    const blocking = result.issues.filter((i) => i.severity === 'blocking');
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.some((i) => /calibrat/i.test(i.code + i.message + (i.remedy ?? '')))).toBe(true);
  });

  it('says so when a page carries no vector line work', async () => {
    // The scanned-drawing case: a page that is a picture of a plan, not a plan.
    const result = await extractPdfLineWork(buildPdf('1 w'));
    expect(result.pages.every((p) => p.segments.length === 0)).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('reports a corrupt file instead of throwing', async () => {
    const rubbish = new Uint8Array(Buffer.from('this is not a PDF at all', 'latin1'));
    const result = await extractPdfLineWork(rubbish);
    expect(result.pages).toHaveLength(0);
    expect(result.issues.some((i) => i.severity === 'blocking')).toBe(true);
  });

  it('reports an empty input instead of throwing', async () => {
    const result = await extractPdfLineWork(new Uint8Array(0));
    expect(result.pages).toHaveLength(0);
    expect(result.issues.some((i) => i.severity === 'blocking')).toBe(true);
  });
});
