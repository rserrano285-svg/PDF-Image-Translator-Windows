import { createWorker, type ImageLike } from 'tesseract.js';

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

export async function ocrImage(image: Blob | ImageLike): Promise<OcrResult> {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(image as ImageLike);
    const raw = (data as { lines?: unknown[] } | null)?.lines;
    const lines: OcrLine[] = Array.isArray(raw)
      ? raw
          .map((entry) => {
            const item = entry as {
              wtext?: string;
              text?: string;
              bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
            };
            const x0 = Math.round(item.bbox?.x0 ?? 0);
            const y0 = Math.round(item.bbox?.y0 ?? 0);
            const x1 = Math.round(item.bbox?.x1 ?? 0);
            const y1 = Math.round(item.bbox?.y1 ?? 0);
            return {
              str: (item.wtext || item.text || '').trim(),
              x: x0,
              y: y0,
              w: Math.max(0, x1 - x0),
              h: Math.max(0, y1 - y0),
            };
          })
          .filter((l) => l.str)
      : [];
    return { text: (data as { text?: string } | null)?.text ?? '', lines };
  } finally {
    await worker.terminate();
  }
}
