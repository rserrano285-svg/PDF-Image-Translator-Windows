import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// URL absoluta del worker (pdf.js lo importa dinámicamente en el fallback de "fake worker").
const workerUrl = new URL(`${process.env.PUBLIC_URL || '/'}pdf.worker.min.mjs`, window.location.href).href;
GlobalWorkerOptions.workerSrc = workerUrl;

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
