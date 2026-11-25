import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
}

export interface TranslatedPage {
  image: string;
  pageWidth: number;
  pageHeight: number;
  items: TranslatedItem[];
}

/** Caracteres extra que la codificación WinAnsi de las fuentes estándar soporta. */
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const REPLACEMENTS: Record<string, string> = {
  '\u2192': '->',
  '\u2190': '<-',
  '\u2191': '^',
  '\u2193': 'v',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2260': '!=',
  '\u00b0': 'o',
  '\u2713': 'v',
  '\u2714': 'v',
  '\u25cf': '-',
  '\u25aa': '-',
  '\u00a0': ' ',
};

/** Elimina caracteres que pdf-lib no puede codificar con Helvetica (WinAnsi). */
function sanitizeForPdf(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 9 || cp === 10 || cp === 13) {
      out += ' ';
    } else if (cp >= 32 && cp <= 126) {
      out += ch;
    } else if (cp >= 0xa0 && cp <= 0xff) {
      out += ch;
    } else if (WINANSI_EXTRA.has(cp)) {
      out += ch;
    } else if (REPLACEMENTS[ch]) {
      out += REPLACEMENTS[ch];
    }
    // El resto (emoji, CJK, símbolos raros) se descarta.
  }
  return out.replace(/\s+/g, ' ').trim();
}

function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 1, g: 1, b: 1 };
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 1, b: 1 };
  const value = parseInt(m[1], 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

function luminance(c: { r: number; g: number; b: number }): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Genera un PDF nuevo: cada página es la imagen renderizada de la página
 * original (diagramas, imágenes y layout intactos). Sobre cada línea traducida
 * se tapa el texto original con el color de fondo y se escribe la traducción
 * ajustada al ancho de la línea para no invadir otras columnas.
 */
export async function generatePdf(pages: TranslatedPage[]): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const pageData of pages) {
    const page = doc.addPage([pageData.pageWidth, pageData.pageHeight]);
    const png = await doc.embedPng(pageData.image);
    page.drawImage(png, { x: 0, y: 0, width: pageData.pageWidth, height: pageData.pageHeight });

    for (const item of pageData.items) {
      const text = sanitizeForPdf(item.str);
      if (!text) continue;

      const fontSize = item.height > 0 ? item.height : 10;
      const background = hexToRgb(item.background);
      const dark = luminance(background) < 0.45;

      // 1) Tapar el texto original (solo el área de esta línea).
      const padX = 1.5;
      const ascent = fontSize * 1.02;
      const descent = fontSize * 0.3;
      page.drawRectangle({
        x: Math.max(0, item.x - padX),
        y: item.y - descent,
        width: Math.min(item.width + padX * 2, pageData.pageWidth - item.x),
        height: ascent + descent,
        color: rgb(background.r, background.g, background.b),
      });

      // 2) Ajustar el tamaño para que la traducción quepa en el espacio libre.
      const widthAtOne = font.widthOfTextAtSize(text, 1);
      const available = Math.max(item.width, item.maxWidth ?? item.width);
      const maxWidth = Math.max(available, fontSize * 2) * 1.02;
      let size = Math.min(fontSize, maxWidth / Math.max(widthAtOne, 0.0001));
      const room = pageData.pageWidth - 4 - Math.max(0, item.x);
      if (widthAtOne * size > room) size = room / Math.max(widthAtOne, 0.0001);
      if (size < 3.5) size = 3.5;

      // 3) Dibujar la traducción sobre la línea base original.
      try {
        page.drawText(text, {
          x: Math.max(0, item.x),
          y: item.y,
          size,
          font,
          color: dark ? rgb(1, 1, 1) : rgb(0.08, 0.08, 0.08),
        });
      } catch {
        // Si alguna cadena no se puede codificar, se deja la línea original visible.
      }
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
