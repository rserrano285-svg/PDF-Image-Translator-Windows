import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// El worker se sirve desde public/ (CRA lo copia al build/dev server).
GlobalWorkerOptions.workerSrc = new URL(`${process.env.PUBLIC_URL || '/'}pdf.worker.min.mjs`, window.location.href).href;

export interface RenderedTextItem {
  str: string;
  x: number;
  y: number;
  height: number;
}

export interface RenderedPage {
  image: string;
  pageWidth: number;
  pageHeight: number;
  textItems: RenderedTextItem[];
}

export async function renderPdfPages(data: ArrayBuffer): Promise<RenderedPage[]> {
  const loadingTask = getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pages: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
      const image = canvas.toDataURL('image/png');
      const content = await page.getTextContent();
      const textItems: RenderedTextItem[] = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;
        textItems.push({
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          height: item.height,
        });
      }
      pages.push({ image, pageWidth: viewport.width, pageHeight: viewport.height, textItems });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
