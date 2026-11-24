import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 612; // Carta, sin cambiar el formato original de las páginas
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const SIZE = 11;
const LINE_HEIGHT = SIZE * 1.2;

type Font = { widthOfTextAtSize: (text: string, size: number) => number };

function wrapWords(words: string[], font: Font, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, SIZE) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generatePdf(pages: { pageNumber: number; text: string }[]): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  for (const pageText of pages) {
    let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const words = pageText.text.split(/\s+/).filter(Boolean);
    const lines = wrapWords(words, font, maxWidth);
    let y = PAGE_HEIGHT - MARGIN - LINE_HEIGHT;
    for (const line of lines) {
      if (y < MARGIN + LINE_HEIGHT) {
        // Si el texto no cabe en una página, continúa en la siguiente.
        page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN - LINE_HEIGHT;
      }
      page.drawText(line, { x: MARGIN, y, size: SIZE, font, color: rgb(0.1, 0.1, 0.1) });
      y -= LINE_HEIGHT;
    }
  }

  const bytes = await doc.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}
