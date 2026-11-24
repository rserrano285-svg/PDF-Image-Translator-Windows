import { ocrImage } from './ocr';
import { translateText } from './translate';

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
  blob: Blob
): Promise<{ canvas: HTMLCanvasElement; text: string }> {
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width || 800;
  canvas.height = img.naturalHeight || img.height || 600;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');

  ctx.drawImage(img, 0, 0);

  const text = await ocrImage(blob);
  const translated = await translateText(text, 'es');

  if (translated.trim()) {
    const size = 14;
    const lines = wrapTextLines(translated, ctx, canvas.width - 20).slice(0, 20);
    ctx.font = `bold ${size}px sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    let y = size + 12;
    for (const line of lines) {
      ctx.strokeText(line, 10, y);
      ctx.fillText(line, 10, y);
      y += size * 1.2;
    }
  }

  return { canvas, text: translated };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type || 'image/png');
  });
}
