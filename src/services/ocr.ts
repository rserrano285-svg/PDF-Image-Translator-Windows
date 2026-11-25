import { createWorker } from 'tesseract.js';

export interface OcrLine {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

/** Convierte la imagen a Blob; tesseract.js acepta mejor blob/DataURL en navegador. */
function toBlob(image: Blob | HTMLCanvasElement): Promise<Blob> {
  return image instanceof Blob
    ? Promise.resolve(image)
    : new Promise((resolve, reject) => {
        image.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen para OCR'))), 'image/png');
      });
}

export async function ocrImage(image: Blob | HTMLCanvasElement): Promise<OcrResult> {
  const worker = await createWorker('eng');
  try {
    // En v7 hay que pedir explícitamente los bloques para obtener posiciones.
    const { data } = await worker.recognize(await toBlob(image), {}, { text: true, blocks: true });
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const str = (line.text ?? '').replace(/\s+/g, ' ').trim();
          if (!str) continue;
          const bbox = line.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
          lines.push({
            str,
            x: Math.round(bbox.x0 ?? 0),
            y: Math.round(bbox.y0 ?? 0),
            w: Math.max(1, Math.round((bbox.x1 ?? 0) - (bbox.x0 ?? 0))),
            h: Math.max(1, Math.round((bbox.y1 ?? 0) - (bbox.y0 ?? 0))),
          });
        }
      }
    }
    return { text: data.text ?? '', lines };
  } finally {
    await worker.terminate();
  }
}
