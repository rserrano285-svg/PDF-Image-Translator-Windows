/**
 * Traducción usando la API pública de Google Translate
 * (translate.googleapis.com) — funciona desde el navegador sin bloqueo CORS,
 * a diferencia de translate.google.com.
 */

const MAX_CHUNK = 3000;

async function translateChunk(text: string, to: string): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const raw = await res.text();
  if (!res.ok) {
    throw new Error('Falló el servicio de traducción');
  }
  const data: unknown = JSON.parse(raw);
  const first = Array.isArray(data) ? data[0] : null;
  const second = Array.isArray(first) ? first[0] : null;
  const third = Array.isArray(second) ? second[0] : null;
  return typeof third === 'string' && third ? third : text;
}

function splitIntoChunks(text: string, max: number): string[] {
  if (text.length <= max) {
    return [text];
  }
  const chunks: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + word.length > max) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export async function translateText(text: string, to: string): Promise<string> {
  if (!text.trim()) {
    return '';
  }
  const translated: string[] = [];
  for (const chunk of splitIntoChunks(text, MAX_CHUNK)) {
    // eslint-disable-next-line no-await-in-loop
    translated.push(await translateChunk(chunk, to));
  }
  return translated.join(' ');
}
