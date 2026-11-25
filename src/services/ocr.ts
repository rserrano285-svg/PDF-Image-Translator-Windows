import { createWorker, type ImageLike } from 'tesseract.js';

export async function ocrImage(
  image: Blob | ImageLike
): Promise<string> {
  const worker = await createWorker('eng');
  try {
    await worker.load();
    const { data } = await worker.recognize(image as ImageLike);
    return data?.text ?? '';
  } finally {
    await worker.terminate();
  }
}
