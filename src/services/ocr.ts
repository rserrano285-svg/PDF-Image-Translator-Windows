import { createWorker } from 'tesseract.js';

export interface OcrLine {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Palabra con posición: permite conservar el color de cada etiqueta. */
export interface OcrWord {
  str: string;
  x: number;
  y0: number;
  y1: number;
  w: number;
  h: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  words: OcrWord[];
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
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const str = (line.text ?? '').replace(/\s+/g, ' ').trim();
          if (str) {
            const bbox = line.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
            lines.push({
              str,
              x: Math.round(bbox.x0 ?? 0),
              y: Math.round(bbox.y0 ?? 0),
              w: Math.max(1, Math.round((bbox.x1 ?? 0) - (bbox.x0 ?? 0))),
              h: Math.max(1, Math.round((bbox.y1 ?? 0) - (bbox.y0 ?? 0))),
            });
          }
          for (const word of line.words ?? []) {
            const text = (word.text ?? '').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const b = word.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
            const x = Math.round(b.x0 ?? 0);
            const y0 = Math.round(b.y0 ?? 0);
            const y1 = Math.round(b.y1 ?? 0);
            words.push({
              str: text,
              x,
              y0,
              y1,
              w: Math.max(1, Math.round((b.x1 ?? 0) - x)),
              h: Math.max(1, y1 - y0),
            });
          }
        }
      }
    }
    return { text: data.text ?? '', lines, words };
  } finally {
    await worker.terminate();
  }
}
