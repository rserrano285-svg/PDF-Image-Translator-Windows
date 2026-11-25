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

interface Color {
  r: number;
  g: number;
  b: number;
}

function toHex(c: Color): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function luminance(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function distance(a: Color, b: Color): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function readPixels(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(x + w));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return null;
  try {
    return { data: ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, w: x1 - x0, h: y1 - y0 };
  } catch {
    return null;
  }
}

/** Color del fondo alrededor del texto. */
function sampleBackground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): Color {
  const pad = 3;
  const area = readPixels(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2);
  if (!area) return { r: 255, g: 255, b: 255 };
  const samples: Color[] = [];
  const stepX = Math.max(1, Math.floor(area.w / 30));
  const stepY = Math.max(1, Math.floor(area.h / 10));
  for (let px = 0; px < area.w; px += stepX) {
    for (const py of [0, area.h - 1]) {
      const i = (py * area.w + px) * 4;
      samples.push({ r: area.data[i], g: area.data[i + 1], b: area.data[i + 2] });
    }
  }
  for (let py = 0; py < area.h; py += stepY) {
    for (const px of [0, area.w - 1]) {
      const i = (py * area.w + px) * 4;
      samples.push({ r: area.data[i], g: area.data[i + 1], b: area.data[i + 2] });
    }
  }
  if (!samples.length) return { r: 255, g: 255, b: 255 };
  const median = (key: 'r' | 'g' | 'b') =>
    samples.map((s) => s[key]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  return { r: median('r'), g: median('g'), b: median('b') };
}

/** Color principal del texto dentro de su caja (para conservar el estilo). */
function sampleInk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: Color): Color | null {
  const area = readPixels(ctx, x, y, w, h);
  if (!area) return null;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const stepX = Math.max(1, Math.floor(area.w / 120));
  const stepY = Math.max(1, Math.floor(area.h / 20));
  let total = 0;
  for (let py = 0; py < area.h; py += stepY) {
    for (let px = 0; px < area.w; px += stepX) {
      const i = (py * area.w + px) * 4;
      const c = { r: area.data[i], g: area.data[i + 1], b: area.data[i + 2] };
      total += 1;
      if (distance(c, bg) < 80) continue;
      const key = `${c.r >> 4}-${c.g >> 4}-${c.b >> 4}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += c.r;
      bucket.g += c.g;
      bucket.b += c.b;
      buckets.set(key, bucket);
    }
  }
  const best = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
  if (!best || best.count / Math.max(1, total) < 0.03) return null;
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

/** Tapa el texto original y dibuja la traducción en el mismo sitio. */
function replaceLine(ctx: CanvasRenderingContext2D, line: OcrLine, text: string): void {
  const x = Math.max(0, line.x - 1);
  const y = Math.max(0, line.y - 1);
  const w = Math.min(line.w + 2, ctx.canvas.width - x);
  const h = Math.min(line.h + 2, ctx.canvas.height - y);
  if (w <= 0 || h <= 0) return;

  const bg = sampleBackground(ctx, x, y, w, h);
  const ink = sampleInk(ctx, x, y, w, h, bg);

  ctx.fillStyle = toHex(bg);
  ctx.fillRect(x, y, w, h);

  let size = Math.max(6, Math.min(h * 0.9, 32));
  ctx.font = `bold ${size}px sans-serif`;
  while (ctx.measureText(text).width > w * 1.05 && size > 6) {
    size -= 0.5;
    ctx.font = `bold ${size}px sans-serif`;
  }

  let color = ink ?? (luminance(bg) < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });
  if (Math.abs(luminance(color) - luminance(bg)) < 0.25) {
    color = luminance(bg) < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  }
  ctx.fillStyle = toHex(color);
  ctx.fillText(text, line.x, Math.min(ctx.canvas.height - 2, line.y + h * 0.78));
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

  // Primero OCR a escala 1×; si no encuentra texto, prueba a 2×.
  let ocr = await ocrImage(canvas);
  let scaleFactor = 1;
  if (!ocr.text.trim()) {
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = Math.max(1, Math.round(canvas.width * 2));
    ocrCanvas.height = Math.max(1, Math.round(canvas.height * 2));
    const octx = ocrCanvas.getContext('2d');
    if (octx) octx.drawImage(canvas, 0, 0, ocrCanvas.width, ocrCanvas.height);
    ocr = await ocrImage(ocrCanvas);
    scaleFactor = canvas.width / ocrCanvas.width;
  }

  const ocrText = ocr.lines.length ? ocr.lines.map((l) => l.str).join('\n') : ocr.text;
  const translated: string[] = [];

  if (ocr.lines.length > 0) {
    // Se traduce cada línea y se dibuja en su lugar: la imagen conserva el
    // diseño y el texto original desaparece bajo el fondo de cada caja.
    for (const line of ocr.lines) {
      if (!line.str) continue;
      // eslint-disable-next-line no-await-in-loop
      const text = await translateText(line.str, to);
      if (!text.trim() || text.trim() === line.str.trim()) continue;
      const scaled: OcrLine = {
        str: text,
        x: Math.round(line.x * scaleFactor),
        y: Math.round(line.y * scaleFactor),
        w: Math.round(line.w * scaleFactor),
        h: Math.round(line.h * scaleFactor),
      };
      replaceLine(ctx, scaled, text);
      translated.push(text);
    }
  } else {
    // Sin posiciones: se dibuja el bloque traducido al principio de la imagen.
    const text = await translateText(ocr.text, to);
    if (text.trim()) {
      const size = 12;
      const words = text.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(candidate).width > canvas.width - 20) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) lines.push(current);
      const band = Math.min(lines.length * size * 1.25 + 10, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(0, 0, canvas.width, band);
      ctx.font = `bold ${size}px sans-serif`;
      ctx.fillStyle = '#111';
      lines.slice(0, 30).forEach((line, i) => ctx.fillText(line, 6, size + 8 + i * size * 1.25));
      translated.push(text);
    }
  }

  return { canvas, text: translated.join('\n'), ocrText };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type || 'image/png');
  });
}
