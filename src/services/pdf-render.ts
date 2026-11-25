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
  /** Ancho disponible hasta el siguiente texto o el borde de la página. */
  maxWidth: number;
  /** Altura de la fuente. */
  height: number;
  /** Color de fondo (hex) bajo el texto; se usa para tapar el original. */
  background: string;
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
  /** Coordenadas en el canvas (origen arriba-izquierda) para muestrear el fondo. */
  left: number;
  top: number;
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Toma el color dominante del borde alrededor del texto (no del texto mismo)
 * para poder tapar el texto original sin romper fondos de color.
 */
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
  const x0 = Math.max(0, Math.floor(left - margin));
  const y0 = Math.max(0, Math.floor(top - margin));
  const x1 = Math.min(canvasWidth, Math.ceil(left + width + margin));
  const y1 = Math.min(canvasHeight, Math.ceil(top + height + margin));
  if (x1 <= x0 || y1 <= y0) return '#ffffff';

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  } catch {
    return '#ffffff';
  }

  const samples: [number, number, number][] = [];
  const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 12));

  for (let x = 0; x < x1 - x0; x += stepX) {
    for (const y of [0, y1 - y0 - 1]) {
      const i = (y * (x1 - x0) + x) * 4;
      if (data[i + 3] > 200) samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  for (let y = 0; y < y1 - y0; y += stepY) {
    for (const x of [0, x1 - x0 - 1]) {
      const i = (y * (x1 - x0) + x) * 4;
      if (data[i + 3] > 200) samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (!samples.length) return '#ffffff';

  const median = (index: number) => {
    const values = samples.map((s) => s[index]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return toHex(median(0), median(1), median(2));
}

/** Une los fragmentos que pdf.js devuelve por palabra en líneas completas. */
function groupIntoLines(raw: RawItem[]): RawItem[][] {
  const sorted = [...raw].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    if (current && current.length) {
      const last = current[current.length - 1];
      const tolerance = Math.max(1.5, Math.max(last.height, item.height) * 0.3);
      const sameLine = Math.abs(last.y - item.y) <= tolerance;
      const gap = item.left - (last.left + last.width);
      const close = gap <= Math.max(12, Math.max(last.height, item.height) * 3) && gap > -Math.max(4, item.height);
      if (sameLine && close) {
        current.push(item);
        continue;
      }
    }
    lines.push([item]);
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
        raw.push({
          str,
          x: vx,
          y: viewport.height - vy,
          width: Math.max(1, item.width),
          height: Math.max(1, item.height),
          left: vx,
          top: vy - Math.max(1, item.height) * 0.95,
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

        // Espacio libre a la derecha: hasta el siguiente texto en la misma franja
        // vertical o hasta el margen de la página. Así los títulos pueden crecer.
        const bandTop = top - height * 0.4;
        const bandBottom = top + height * 1.6;
        const obstacles = raw.filter(
          (item) => item.left >= right - 1 && item.top < bandBottom && item.top + item.height * 1.4 > bandTop
        );
        const nextLeft = obstacles.length
          ? Math.min(...obstacles.map((item) => item.left))
          : viewport.width - 8;
        const maxWidth = Math.max(right - left, nextLeft - left - 2);

        textItems.push({
          str,
          x: left,
          y: baseline,
          width: Math.max(1, right - left),
          maxWidth,
          height,
          background: ctx
            ? sampleBackground(
                ctx,
                left * scale,
                top * scale,
                (right - left) * scale,
                height * 1.25 * scale,
                canvas.width,
                canvas.height
              )
            : '#ffffff',
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
