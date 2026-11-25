import { ocrImage, type OcrLine } from './ocr';
import { translateText, type Lang } from './translate';

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = URL.createObjectURL(blob);
  });
}

function wrapTextLines(text: string, ctx: CanvasRenderingContext2D, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Dibuja un texto con fondo legible, en la posición dada de la imagen. */
function drawLineOnCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  widthLimit?: number
): void {
  const lines = wrapTextLines(text, ctx, widthLimit ?? ctx.canvas.width - x - 12).slice(0, 5);
  const step = size * 1.25;
  let currentY = y;
  for (const line of lines) {
    if (currentY + step > ctx.canvas.height) break;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(Math.max(0, Math.round(x - 2)), Math.round(currentY - 2), Math.round(size * 12) + 4, Math.ceil(step + 2));
    ctx.font = `bold ${size}px sans-serif`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeText(line, x + 1, currentY + size * 0.8);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillText(line, x + 1, currentY + size * 0.8);
    currentY += step;
  }
}

export async function translateImageToCanvas(
  blob: Blob,
  to: Lang = 'es'
): Promise<{ canvas: HTMLCanvasElement; text: string; ocrText: string }> {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width || 800;
  canvas.height = img.naturalHeight || img.height || 600;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');

  ctx.drawImage(img, 0, 0);

  // Ampliamos 2× para el OCR: reconoce mejor texto en imágenes grandes.
  const scale = 2;
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  ocrCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const octx = ocrCanvas.getContext('2d');
  if (octx) octx.drawImage(canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);

  const ocr = await ocrImage(ocrCanvas);
  const ocrText = ocr.lines.length ? ocr.lines.map((l) => l.str).join('\n') : ocr.text;

  const scaleFactor = canvas.width / ocrCanvas.width; // 0.5 (coords del OCR a la imagen)

  // Traduce cada línea del OCR, de modo que se dibuja en su lugar.
  const translatedLines: { line: OcrLine; translated: string }[] = [];
  for (const line of ocr.lines) {
    if (!line.str) continue;
    // eslint-disable-next-line no-await-in-loop
    const translated = await translateText(line.str, to);
    if (translated.trim()) translatedLines.push({ line, translated });
  }

  if (translatedLines.length > 0) {
    for (const { line, translated } of translatedLines) {
      const x = Math.max(0, line.x * scaleFactor + 2);
      const y = line.y * scaleFactor;
      const size = Math.min(14, Math.max(8, Math.round(line.h * scaleFactor || 10)));
      drawLineOnCanvas(ctx, translated, x, y + size * 0.7, size, Math.min(canvas.width - x - 4, line.w * scaleFactor + 24));
    }
  } else {
    const translated = await translateText(ocr.text, to);
    if (translated.trim()) {
      const size = 12;
      drawLineOnCanvas(ctx, translated, 6, size + 8, size, canvas.width - 20);
    }
  }

  return { canvas, text: translatedLines.map((t) => t.translated).join('\n'), ocrText };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type || 'image/png');
  });
}
