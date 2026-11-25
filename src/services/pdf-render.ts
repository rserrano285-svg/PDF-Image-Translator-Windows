import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// El worker se sirve desde public/ (CRA lo copia al build/dev server).
GlobalWorkerOptions.workerSrc = new URL(`${process.env.PUBLIC_URL || '/'}pdf.worker.min.mjs`, window.location.href).href;

export interface RenderedTextItem {
  /** Texto de la línea completa (los fragmentos de pdf.js se unen). */
  str: string;
  /** Coordenada X del inicio de la línea (en puntos, espacio de la página). */
  x: number;
  /** Línea base de la línea, con origen abajo-izquierda (espacio de la página). */
  y: number;
  /** Ancho aproximado de la línea original. */
  width: number;
  /** Ancho máximo que puede ocupar la traducción sin invadir otros elementos. */
  maxWidth: number;
  /** Altura de la fuente. */
  height: number;
  /** Color de fondo (hex) bajo el texto; se usa para tapar el original. */
  background: string;
  /** Color del texto original (hex), para conservar el estilo. */
  color: string;
}

export interface RenderedPage {
  image: string;
  pageWidth: number;
  pageHeight: number;
  textItems: RenderedTextItem[];
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Coordenadas en el espacio de la página (origen arriba-izquierda). */
  left: number;
  top: number;
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

interface Box {
  r: number;
  g: number;
  b: number;
}

function colorDistance(a: Box, b: Box): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function readPixels(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvasWidth, Math.ceil(x + width));
  const y1 = Math.min(canvasHeight, Math.ceil(y + height));
  if (x1 <= x0 || y1 <= y0) return null;
  try {
    return { data: ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, w: x1 - x0, h: y1 - y0 };
  } catch {
    return null;
  }
}

/** Color dominante del borde alrededor del texto (el fondo real). */
function sampleBackground(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number
): string {
  const margin = 4;
  const pixels = readPixels(ctx, left - margin, top - margin, width + margin * 2, height + margin * 2, canvasWidth, canvasHeight);
  if (!pixels) return '#ffffff';

  const samples: Box[] = [];
  const stepX = Math.max(1, Math.floor(pixels.w / 24));
  const stepY = Math.max(1, Math.floor(pixels.h / 12));
  for (let x = 0; x < pixels.w; x += stepX) {
    for (const y of [0, pixels.h - 1]) {
      const i = (y * pixels.w + x) * 4;
      if (pixels.data[i + 3] > 200) {
        samples.push({ r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] });
      }
    }
  }
  for (let y = 0; y < pixels.h; y += stepY) {
    for (const x of [0, pixels.w - 1]) {
      const i = (y * pixels.w + x) * 4;
      if (pixels.data[i + 3] > 200) {
        samples.push({ r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] });
      }
    }
  }
  if (!samples.length) return '#ffffff';

  const median = (key: 'r' | 'g' | 'b') => {
    const values = samples.map((s) => s[key]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return toHex(median('r'), median('g'), median('b'));
}

/** Color del texto: el tono dominante distinto del fondo dentro de la caja. */
function sampleTextColor(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  background: Box,
  canvasWidth: number,
  canvasHeight: number
): string | null {
  const pixels = readPixels(ctx, left, top, width, height, canvasWidth, canvasHeight);
  if (!pixels) return null;

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const stepX = Math.max(1, Math.floor(pixels.w / 120));
  const stepY = Math.max(1, Math.floor(pixels.h / 24));
  let total = 0;
  for (let y = 0; y < pixels.h; y += stepY) {
    for (let x = 0; x < pixels.w; x += stepX) {
      const i = (y * pixels.w + x) * 4;
      if (pixels.data[i + 3] < 200) continue;
      total += 1;
      const c = { r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] };
      if (colorDistance(c, background) < 90) continue;
      const key = `${c.r >> 4}-${c.g >> 4}-${c.b >> 4}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += c.r;
      bucket.g += c.g;
      bucket.b += c.b;
      buckets.set(key, bucket);
    }
  }
  if (!total) return null;
  const best = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
  if (!best || best.count / total < 0.03) return null;
  return toHex(best.r / best.count, best.g / best.count, best.b / best.count);
}

/** ¿La zona a la derecha del texto es fondo liso? (permite agrandar la traducción) */
function isUniformArea(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  background: Box,
  canvasWidth: number,
  canvasHeight: number
): boolean {
  if (width < 4) return true;
  const pixels = readPixels(ctx, left, top, width, height, canvasWidth, canvasHeight);
  if (!pixels) return false;
  const stepX = Math.max(2, Math.floor(pixels.w / 80));
  const stepY = Math.max(2, Math.floor(pixels.h / 8));
  let total = 0;
  let different = 0;
  for (let y = 0; y < pixels.h; y += stepY) {
    for (let x = 0; x < pixels.w; x += stepX) {
      const i = (y * pixels.w + x) * 4;
      if (pixels.data[i + 3] < 200) continue;
      total += 1;
      const c = { r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2] };
      if (colorDistance(c, background) > 40) different += 1;
    }
  }
  return total === 0 || different / total < 0.01;
}

/**
 * Agrupa los fragmentos de pdf.js en líneas completas: primero por línea base
 * (tolerante a negritas/cursivas) y después separando columnas por el hueco.
 */
function groupIntoLines(raw: RawItem[]): RawItem[][] {
  const sorted = [...raw].sort((a, b) => b.y - a.y);
  const clusters: { y: number; height: number; items: RawItem[] }[] = [];

  for (const item of sorted) {
    let best: (typeof clusters)[number] | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) {
      const diff = Math.abs(cluster.y - item.y);
      const tolerance = Math.max(1.5, Math.max(cluster.height, item.height) * 0.35);
      if (diff <= tolerance && diff < bestDiff) {
        best = cluster;
        bestDiff = diff;
      }
    }
    if (best) {
      best.items.push(item);
      best.height = Math.max(best.height, item.height);
    } else {
      clusters.push({ y: item.y, height: item.height, items: [item] });
    }
  }

  const lines: RawItem[][] = [];
  for (const cluster of clusters) {
    const items = [...cluster.items].sort((a, b) => a.left - b.left);
    let run: RawItem[] = [];
    for (const item of items) {
      if (!run.length) {
        run = [item];
        continue;
      }
      const last = run[run.length - 1];
      // Un solapamiento leve (texto posterior dibujado sobre el anterior, trazo
      // + relleno) no separa líneas: se une para traducir el texto una sola vez.
      const gap = item.left - (last.left + last.width);
      const maxGap = Math.max(14, Math.max(last.height, item.height) * 2.5);
      const overlapTolerance = Math.max(4, Math.max(last.height, item.height));
      const sameText = last.str.trim() === item.str.trim();
      if ((gap <= maxGap && gap > -overlapTolerance) || (gap <= maxGap && sameText && gap > -overlapTolerance * 2)) {
        run.push(item);
      } else if (gap <= maxGap) {
        // Solapamiento grande: separa columnas, pero une si es del mismo texto.
        if (sameText) run.push(item);
        else {
          lines.push(run);
          run = [item];
        }
      } else {
        lines.push(run);
        run = [item];
      }
    }
    if (run.length) lines.push(run);
  }
  return lines;
}

export async function renderPdfPages(data: ArrayBuffer): Promise<RenderedPage[]> {
  const loadingTask = getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      // Las coordenadas se guardan en puntos (escala 1) para que la página del
      // PDF final conserve su tamaño real; la imagen se renderiza más grande
      // para que los diagramas se vean nítidos.
      const viewport = page.getViewport({ scale: 1 });
      const maxSide = Math.max(viewport.width, viewport.height);
      const scale = Math.max(1, Math.min(2, 3200 / maxSide));
      const renderViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;
      }

      const content = await page.getTextContent();
      const raw: RawItem[] = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue;
        const str = item.str.replace(/\s+/g, ' ').trim();
        if (!str) continue;
        const tx = item.transform[4] ?? 0;
        const ty = item.transform[5] ?? 0;
        const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
        const width = Math.max(1, item.width);
        const height = Math.max(1, item.height);
        const y = viewport.height - vy;
        // Descartar duplicados exactos (trazo + relleno de un mismo texto).
        const duplicate = raw.some(
          (r) =>
            r.str === str && Math.abs(r.x - vx) < 2 && Math.abs(r.y - y) < 2 && Math.abs(r.width - width) < 2 && Math.abs(r.height - height) < 2
        );
        if (duplicate) continue;
        raw.push({
          str,
          x: vx,
          y,
          width,
          height,
          left: vx,
          top: vy - height * 0.95,
        });
      }

      const textItems: RenderedTextItem[] = [];
      for (const line of groupIntoLines(raw)) {
        const str = line.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        const height = Math.max(...line.map((i) => i.height));
        const left = Math.min(...line.map((i) => i.left));
        const right = Math.max(...line.map((i) => i.left + i.width));
        const top = Math.min(...line.map((i) => i.top));
        const baseline = Math.max(...line.map((i) => i.y));

        // Solo interesa traducir líneas con letras (no códigos, números ni barras).
        if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(str)) continue;

        const background = ctx
          ? sampleBackground(
              ctx,
              left * scale,
              top * scale,
              (right - left) * scale,
              height * 1.25 * scale,
              canvas.width,
              canvas.height
            )
          : '#ffffff';
        const bgRgb = {
          r: parseInt(background.slice(1, 3), 16),
          g: parseInt(background.slice(3, 5), 16),
          b: parseInt(background.slice(5, 7), 16),
        };

        // Espacio libre a la derecha: hasta el siguiente texto de la franja.
        const bandTop = top - height * 0.4;
        const bandBottom = top + height * 1.6;
        const obstacles = raw.filter(
          (item) => item.left >= right - 1 && item.top < bandBottom && item.top + item.height * 1.4 > bandTop
        );
        const nextLeft = obstacles.length ? Math.min(...obstacles.map((item) => item.left)) : viewport.width - 8;
        let maxWidth = Math.max(right - left, nextLeft - left - 2);

        // Solo se permite crecer si esa zona es fondo liso (sin logos, líneas
        // ni imágenes), para no invadir otros elementos del diseño.
        if (maxWidth > right - left + 2 && ctx) {
          const free = maxWidth - (right - left) - 2;
          const uniform = isUniformArea(
            ctx,
            (right + 2) * scale,
            top * scale,
            free * scale,
            height * 1.25 * scale,
            bgRgb,
            canvas.width,
            canvas.height
          );
          if (!uniform) maxWidth = (right - left) * 1.02;
        }

        const color = ctx
          ? sampleTextColor(
              ctx,
              left * scale,
              top * scale,
              (right - left) * scale,
              height * 1.25 * scale,
              bgRgb,
              canvas.width,
              canvas.height
            )
          : null;

        textItems.push({
          str,
          x: left,
          y: baseline,
          width: Math.max(1, right - left),
          maxWidth,
          height,
          background,
          color: color ?? '',
        });
      }

      pages.push({
        image: canvas.toDataURL('image/png'),
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        textItems,
      });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
