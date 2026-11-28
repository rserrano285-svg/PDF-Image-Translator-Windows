import { ocrImage, type OcrLine, type OcrWord } from './ocr';
import { translateText, type Lang } from './translate';

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen')); };
    img.src = url;
  });
}

interface Color {
  r: number;
  g: number;
  b: number;
}

interface WordLine {
  items: OcrWord[];
  x: number;
  x1: number;
  y0: number;
  y1: number;
  h: number;
  maxH: number;
}

interface ColorSegment {
  text: string;
  color: Color;
  x0: number;
  x1: number;
  out: string;
}

function toHex(c: Color): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function luminance(c: Color): number {
  // getImageData devuelve canales 0-255; normalizamos a 0-1 para los umbrales.
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
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

/** Color dominante de una zona: con exclude se obtiene la tinta, sin él el fondo. */
function modeColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, exclude?: Color, tol = 0): Color | null {
  const area = readPixels(ctx, x, y, w, h);
  if (!area) return null;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  let total = 0;
  const stepX = Math.max(1, Math.floor(area.w / 80));
  const stepY = Math.max(1, Math.floor(area.h / 20));
  for (let py = 0; py < area.h; py += stepY) {
    for (let px = 0; px < area.w; px += stepX) {
      const i = (py * area.w + px) * 4;
      if (area.data[i + 3] < 200) continue;
      total += 1;
      const c = { r: area.data[i], g: area.data[i + 1], b: area.data[i + 2] };
      if (exclude && distance(c, exclude) < tol) continue;
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
  if (!best || !total) return null;
  if (exclude && best.count / total < 0.012) return null;
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

/** Agrupa las palabras del OCR en líneas por altura de baseline. */
function groupWordLines(words: OcrWord[]): WordLine[] {
  const items = [...words].sort((a, b) => a.y0 - b.y0 || a.x - b.x);
  const lines: WordLine[] = [];
  for (const item of items) {
    let best: WordLine | null = null;
    let bestDiff = Infinity;
    for (const line of lines) {
      const diff = Math.abs(line.y1 - item.y1);
      const tol = Math.max(4, line.h * 0.5);
      if (diff <= tol && diff < bestDiff) {
        best = line;
        bestDiff = diff;
      }
    }
    if (best) {
      best.items.push(item);
      best.x = Math.min(best.x, item.x);
      best.x1 = Math.max(best.x1, item.x + item.w);
      best.y0 = Math.min(best.y0, item.y0);
      best.y1 = Math.max(best.y1, item.y1);
      best.h = Math.max(best.h, item.h);
    } else {
      lines.push({
        items: [item],
        x: item.x,
        x1: item.x + item.w,
        y0: item.y0,
        y1: item.y1,
        h: item.h,
        maxH: item.h,
      });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.y0 - b.y0);
}

/** Divide una línea en tramos de igual color (etiqueta roja + texto blanco). */
function colorSegments(line: WordLine, ctx: CanvasRenderingContext2D): ColorSegment[] {
  const segments: ColorSegment[] = [];
  for (const word of line.items) {
    const x = Math.max(0, word.x - 1);
    const y = Math.max(0, word.y0 - 1);
    const w = Math.min(word.w + 2, ctx.canvas.width - x);
    const h = Math.min(word.h + 2, ctx.canvas.height - y);
    const bg = modeColor(ctx, x, y, w, h) ?? { r: 0, g: 0, b: 0 };
    const ink = modeColor(ctx, x, y, w, h, bg, 70);
    const color = ink ?? (luminance(bg) < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 10, g: 10, b: 10 });
    const last = segments[segments.length - 1];
    if (last && distance(last.color, color) < 70) {
      last.text += (last.text ? ' ' : '') + word.str;
      last.x1 = word.x + word.w;
    } else {
      segments.push({ text: word.str, color, x0: word.x, x1: word.x + word.w, out: '' });
    }
  }
  return segments;
}

/** Dibuja la traducción reduciendo la fuente hasta que cabe en ancho y alto. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  maxWidth: number,
  maxHeight: number,
  baseSize: number,
  color: Color,
  bold: boolean
): void {
  const words = text.split(/\s+/).filter(Boolean);
  let size = Math.max(8, Math.min(baseSize, 40));
  let rows: string[] = [];
  for (; size >= 8; size -= 0.5) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
    rows = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        rows.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) rows.push(current);
    if (rows.every((row) => ctx.measureText(row).width <= maxWidth) && rows.length * size * 1.08 <= maxHeight) break;
  }
  ctx.fillStyle = toHex(color);
  const lineHeight = size * 1.08;
  rows.forEach((row, index) => {
    ctx.fillText(row, x, Math.min(ctx.canvas.height - 2, top + size + index * lineHeight));
  });
}

/** Método anterior, usado solo como respaldo cuando el OCR no da palabras. */
function replaceLine(ctx: CanvasRenderingContext2D, line: OcrLine, text: string): void {
  const x = Math.max(0, line.x - 1);
  const y = Math.max(0, line.y - 1);
  const w = Math.min(line.w + 2, ctx.canvas.width - x);
  const h = Math.min(line.h + 2, ctx.canvas.height - y);
  if (w <= 0 || h <= 0) return;
  const area = readPixels(ctx, x - 3, y - 3, w + 6, h + 6);
  const bg: Color = area ? modeColor(ctx, x - 3, y - 3, w + 6, h + 6) ?? { r: 255, g: 255, b: 255 } : { r: 255, g: 255, b: 255 };
  const ink = modeColor(ctx, x, y, w, h);
  const maxWidth = Math.max(1, w - 3);
  const words = text.split(/\s+/).filter(Boolean);
  const wrapLines = (size: number): string[] => {
    ctx.font = `bold ${size}px sans-serif`;
    const out: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        out.push(current);
        current = word;
      } else current = candidate;
    }
    if (current) out.push(current);
    return out;
  };
  let size = Math.max(6, Math.min(line.h, 32));
  let rows = wrapLines(size);
  let attempts = 0;
  while ((rows.length > 2 || rows.some((row) => ctx.measureText(row).width > maxWidth)) && size > 6 && attempts < 30) {
    size -= 0.5;
    rows = wrapLines(size);
    attempts += 1;
  }
  const widest = Math.max(...rows.map((row) => ctx.measureText(row).width), 1);
  if (widest > maxWidth) {
    size = Math.max(4, (size * maxWidth) / widest);
    ctx.font = `bold ${size}px sans-serif`;
  }
  ctx.fillStyle = toHex(bg);
  ctx.fillRect(x, y, w, h);
  let color = ink ?? (luminance(bg) < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });
  if (Math.abs(luminance(color) - luminance(bg)) < 0.25) {
    color = luminance(bg) < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  }
  ctx.fillStyle = toHex(color);
  const lineHeight = h / rows.length;
  rows.forEach((row, index) => {
    ctx.fillText(row, line.x, Math.min(ctx.canvas.height - 2, line.y + h * 0.78 + index * lineHeight));
  });
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

  if (ocr.words.length > 0) {
    const scaled: OcrWord[] = ocr.words.map((word) => ({
      str: word.str,
      x: word.x * scaleFactor,
      y0: word.y0 * scaleFactor,
      y1: word.y1 * scaleFactor,
      w: word.w * scaleFactor,
      h: word.h * scaleFactor,
    }));
    const lines = groupWordLines(scaled);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const next = lines[i + 1];
      line.maxH = next
        ? Math.max(line.h * 1.2, Math.min(next.y0 - line.y0 - 2, line.h * 3.2))
        : Math.max(line.h * 1.35, 20);
    }

    for (const line of lines) {
      const full = line.items.map((word) => word.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!/\p{L}/u.test(full)) continue;
      const segments = colorSegments(line, ctx);
      // eslint-disable-next-line no-await-in-loop
      for (const segment of segments) segment.out = await translateText(segment.text, to);
      if (!segments.some((segment) => segment.out.trim() && segment.out.trim() !== segment.text.trim())) continue;

      const left = Math.max(0, line.x - 2);
      const top = Math.max(0, line.y0 - 2);
      const boxW = Math.min(line.x1 - left + 4, canvas.width - left);
      const boxH = Math.min(line.maxH + 4, canvas.height - top);
      const bg = modeColor(ctx, left, top, boxW, boxH) ?? { r: 0, g: 0, b: 0 };
      ctx.fillStyle = toHex(bg);
      ctx.fillRect(left, top, boxW, boxH);

      const lineW = Math.max(24, line.x1 - line.x);
      const base = Math.max(10, Math.min(line.h * 1.05, 32));
      const weights = segments.map((segment) =>
        Math.max(24, segment.x1 - segment.x0, (segment.out || segment.text).length * base * 0.5)
      );
      const sumW = weights.reduce((a, b) => a + b, 0);
      const bold = line.h >= 38;
      let cursor = line.x;
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const segW = Math.max(28, (lineW * weights[index]) / sumW);
        drawFitted(ctx, segment.out || segment.text, cursor, top, segW, line.maxH, base, segment.color, bold);
        cursor += segW + 2;
        translated.push(segment.out || segment.text);
      }
    }
  } else if (ocr.lines.length > 0) {
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
        } else current = candidate;
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

  if (!translated.length) {
    throw new Error('No se pudo traducir la imagen: no se encontró texto legible o la traducción no cambió el texto.');
  }

  return { canvas, text: translated.join('\n'), ocrText };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type || 'image/png');
  });
}
