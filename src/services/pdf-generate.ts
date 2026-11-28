import { PDFDocument } from 'pdf-lib';

export interface TranslatedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Ancho máximo que puede ocupar la traducción (espacio libre a la derecha). */
  maxWidth?: number;
  height: number;
  /** Color de fondo original bajo el texto (hex). */
  background?: string;
  /** Color del texto original (hex). */
  color?: string;
}

export interface TranslatedPage {
  image: string;
  pageWidth: number;
  pageHeight: number;
  items: TranslatedItem[];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen de la página'));
    img.src = src;
  });
}

/** Ajusta el texto al ancho disponible, partiéndolo en renglones si hace falta. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number
): { lines: string[]; size: number } {
  ctx.font = `bold ${size}px sans-serif`;
  const words = text.split(/\s+/).filter(Boolean);
  const build = (fontSize: number) => {
    ctx.font = `bold ${fontSize}px sans-serif`;
    const rows: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        rows.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) rows.push(current);
    return rows;
  };

  let fontSize = size;
  let lines = build(fontSize);
  let guard = 0;
  while ((lines.length > 2 || lines.some((l) => ctx.measureText(l).width > maxWidth)) && fontSize > 7 && guard < 30) {
    fontSize -= 0.5;
    lines = build(fontSize);
    guard += 1;
  }
  const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  if (widest > maxWidth) {
    fontSize = Math.max(6, (fontSize * maxWidth) / widest);
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = build(fontSize);
  }
  return { lines, size: fontSize };
}

/**
 * Genera un PDF nuevo: cada página conserva el diseño original (imagen
 * renderizada) y el texto traducido se dibuja sobre esa imagen con las fuentes
 * del sistema, por lo que funciona también con chino, ruso, árabe, japonés o
 * coreano (que Helvetica/WinAnsi no puede codificar).
 */
export async function generatePdf(pages: TranslatedPage[]): Promise<Blob> {
  const doc = await PDFDocument.create();

  for (const pageData of pages) {
    const landscape = pageData.pageWidth >= pageData.pageHeight;
    const w = landscape
      ? Math.max(pageData.pageWidth, pageData.pageHeight)
      : Math.min(pageData.pageWidth, pageData.pageHeight);
    const h = landscape
      ? Math.min(pageData.pageWidth, pageData.pageHeight)
      : Math.max(pageData.pageWidth, pageData.pageHeight);

    const img = await loadImage(pageData.image);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || Math.ceil(pageData.pageWidth);
    canvas.height = img.naturalHeight || Math.ceil(pageData.pageHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas no disponible para generar el PDF');
    ctx.drawImage(img, 0, 0);
    const sx = canvas.width / pageData.pageWidth;
    const sy = canvas.height / pageData.pageHeight;

    for (const item of pageData.items) {
      const text = item.str.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      const fontSize = Math.max(6, item.height || 10);
      const baselineTop = pageData.pageHeight - item.y; // canvas: origen arriba
      const x = Math.max(0, (item.x - 1.5) * sx);
      const yTop = (baselineTop - fontSize * 1.02) * sy;
      const bg = item.background || '#ffffff';

      // 1) Tapar el texto original con el color de fondo muestreado.
      ctx.fillStyle = bg;
      ctx.fillRect(x, yTop, (item.width + 3) * sx, fontSize * 1.35 * sy);

      // 2) Dibujar la traducción en el mismo lugar, con fuentes Unicode del sistema.
      const { lines, size } = wrapText(ctx, text, Math.max(20, (item.maxWidth ?? item.width) * sx * 1.04), fontSize * sy);
      ctx.font = `bold ${size}px sans-serif`;
      ctx.fillStyle = item.color || (luminanceHex(bg) < 0.5 ? '#ffffff' : '#111111');
      const baselineCanvas = baselineTop * sy;
      lines.forEach((line, index) => {
        ctx.fillText(line, x + 2, baselineCanvas - size * 0.15 + index * size * 1.12);
      });
    }

    const png = await doc.embedPng(canvas.toDataURL('image/png'));
    const page = doc.addPage([w, h]);
    page.drawImage(png, { x: 0, y: 0, width: w, height: h });
  }

  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

function luminanceHex(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
