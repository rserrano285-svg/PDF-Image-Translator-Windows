import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// En webpack 5, lo típico para resolver el worker del pdf.js al empaquetar.
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export async function extractPdfText(data: ArrayBuffer): Promise<PdfPageText[]> {
  const loadingTask = getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = (content.items ?? [])
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push({ pageNumber: n, text });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
