import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface TranslatedPage {
  image: string;
  pageWidth: number;
  pageHeight: number;
  items: { str: string; x: number; y: number; height: number }[];
}

/** Genera un PDF nuevo: cada página es la imagen renderizada de la página original
 *  con el texto traducido dibujado sobre ella (mantiene el formato original:
 *  diagramas, imágenes y layout). */
export async function generatePdf(pages: TranslatedPage[]): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const pageData of pages) {
    const page = doc.addPage([pageData.pageWidth, pageData.pageHeight]);
    const png = await doc.embedPng(pageData.image);
    page.drawImage(png, { x: 0, y: 0, width: pageData.pageWidth, height: pageData.pageHeight });
    for (const item of pageData.items) {
      if (!item.str.trim()) continue;
      page.drawText(item.str, {
        x: item.x,
        y: item.y,
        size: item.height || 11,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
