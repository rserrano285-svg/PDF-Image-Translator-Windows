import { ocrImage } from './ocr';
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

  const ocrText = await ocrImage(ocrCanvas);
  const text = await translateText(ocrText, to);

  if (text.trim()) {
    const size = 12;
    const lines = wrapTextLines(text, ctx, canvas.width - 20).slice(0, 30);
    const bandHeight = Math.min(lines.length * size * 1.25 + 10, canvas.height);
    // Fondo translúcido detrás del texto traducido.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(0, 0, canvas.width, bandHeight);
    ctx.font = `bold ${size}px sans-serif`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1.5;
    let y = size + 8;
    for (const line of lines) {
      ctx.strokeText(line, 6, y);
      ctx.fillText(line, 6, y);
      y += size * 1.25;
    }
  }

  return { canvas, text, ocrText };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type || 'image/png');
  });
}
