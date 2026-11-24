import { createWorker } from 'tesseract.js';

export async function ocrImage(imageBlob: Blob): Promise<string> {
  const worker = await createWorker('eng');
  try {
    await worker.load();
    const { data } = await worker.recognize(imageBlob);
    return data?.text ?? '';
  } finally {
    await worker.terminate();
  }
}
