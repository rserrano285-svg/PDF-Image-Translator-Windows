/**
 * Traducción con detección de idioma.
 *
 * Usa el endpoint público de Google (clients5.google.com), que permite CORS
 * desde el navegador y devuelve el idioma detectado, de modo que el texto que
 * ya está en el idioma de destino se deja intacto (antes se "retraducía" y se
 * empalmaba con el original).
 *
 * Para no hacer una petición por línea, las líneas del mismo idioma se envían
 * en un solo bloque separadas por saltos de línea (Google los conserva).
 */

export type Lang = 'es' | 'en';

const GOOGLE_URL = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex';
const GOOGLE_SINGLE_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t';
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const MAX_CHUNK = 1800;
const MAX_CONCURRENT = 8;
const LETTER_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]/;

/* ------------------------------------------------------------------ */
/* Concurrencia                                                        */
/* ------------------------------------------------------------------ */

let activeRequests = 0;
const waiters: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeRequests += 1;
  try {
    return await fn();
  } finally {
    activeRequests -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

/* ------------------------------------------------------------------ */
/* Detección de idioma (rápida, sin red)                               */
/* ------------------------------------------------------------------ */

const ES_WORDS = new Set(
  `el la los las un una unos unas de del que y en es son por para con sin se su sus al lo
   como mas pero este esta estos estas entre cuando donde muy tambien sobre hasta desde le les
   nos hay fue ser segun cada otro otra durante mediante puede pueden debe deben figura tabla
   seccion ejemplo paginas proyecto estado resultados titulo subtitulo informe valores medidos
   sistema descripcion general procedimiento medicion detalle siguiente contenido resumen
   introduccion conclusion metodo metodos capitulo apendice nota notas fuente total`
    .split(/\s+/)
    .filter(Boolean)
);

const EN_WORDS = new Set(
  `the and of to in is are was were for with on at by from this that these those as be been has
   have had will would can could should not or it its their there which when where how all more
   also between into than then out about over after before under above page pages figure table
   section example report title results system overview values measured description procedure
   following detail status project data summary introduction conclusion method methods chapter
   appendix notes source total`
    .split(/\s+/)
    .filter(Boolean)
);

function normalizeWord(word: string): string {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Devuelve 'es' o 'en' si está claro; null si no se puede decidir. */
export function detectLanguage(text: string): Lang | null {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zà-öø-ÿ]+/).filter(Boolean);
  let es = 0;
  let en = 0;
  for (const word of words) {
    const w = normalizeWord(word);
    if (ES_WORDS.has(w)) es += 1;
    if (EN_WORDS.has(w)) en += 1;
  }
  // Acentos y signos propios del español son una señal fuerte.
  if (/[áéíóúñü¿¡]/i.test(text)) es += 2;

  if (es === 0 && en === 0) return null;
  if (es > en) return 'es';
  if (en > es) return 'en';
  return null;
}

/* ------------------------------------------------------------------ */
/* Peticiones                                                          */
/* ------------------------------------------------------------------ */

interface GoogleReply {
  text: string;
  detected: Lang | null;
}

function normalizeLang(value: unknown): Lang | null {
  return value === 'es' || value === 'en' ? value : null;
}

function parseGoogleReply(data: unknown): GoogleReply | null {
  if (!Array.isArray(data) || !data.length) return null;
  const first: unknown = data[0];

  // Formato clients5: [["texto traducido","en"]]
  if (Array.isArray(first) && typeof first[0] === 'string') {
    return { text: first[0], detected: normalizeLang(first[1]) };
  }
  // Formato gtx: [[["texto","original",...], ...], null, "en"]
  if (Array.isArray(first) && Array.isArray(first[0])) {
    const text = (first as unknown[][])
      .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
      .join('');
    return { text, detected: normalizeLang(data[2]) };
  }
  // Formato plano: ["texto","en"]
  if (typeof first === 'string') {
    return { text: first, detected: normalizeLang(data[1]) };
  }
  return null;
}

async function requestGoogle(text: string, from: Lang | 'auto', to: Lang): Promise<GoogleReply> {
  const url = `${GOOGLE_URL}&sl=${from}&tl=${to}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Traducción HTTP ${res.status}`);
  const reply = parseGoogleReply(await res.json());
  if (!reply) throw new Error('Respuesta de traducción no reconocida');
  return reply;
}

async function requestGoogleSingle(text: string, from: Lang | 'auto', to: Lang): Promise<GoogleReply> {
  const url = `${GOOGLE_SINGLE_URL}&sl=${from}&tl=${to}&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Traducción HTTP ${res.status}`);
  const reply = parseGoogleReply(await res.json());
  if (!reply) throw new Error('Respuesta de traducción no reconocida');
  return reply;
}

async function requestMyMemory(text: string, from: Lang, to: Lang): Promise<string> {
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Traducción HTTP ${res.status}`);
  const data = (await res.json()) as { responseData?: { translatedText?: string } };
  return data.responseData?.translatedText ?? '';
}

function looksLikeError(text: string): boolean {
  return /MYMEMORY WARNING|PLEASE SELECT TWO DISTINCT|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|NO QUERY SPECIFIED/i.test(
    text
  );
}

/**
 * Evita traducir celdas que en realidad son unidades, códigos o letras sueltas
 * (p. ej. "C" → "do", "kPa", "A-102"), que Google traduce sin sentido.
 */
function isTranslatable(text: string): boolean {
  const letters = text.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g)?.length ?? 0;
  if (letters < 2) return false;
  if (!text.includes(' ') && text.length <= 3) return false;
  return true;
}

async function translateOne(text: string, from: Lang | null, to: Lang): Promise<string> {
  try {
    const reply = await withSlot(() => requestGoogle(text, from ?? 'auto', to));
    if (reply.detected === to) return text; // ya estaba en el idioma de destino
    const translated = reply.text.trim();
    if (translated && !looksLikeError(translated)) return translated;
  } catch {
    // Se intenta con los respaldos.
  }
  try {
    const reply = await withSlot(() => requestGoogleSingle(text, from ?? 'auto', to));
    if (reply.detected === to) return text;
    const translated = reply.text.trim();
    if (translated && !looksLikeError(translated)) return translated;
  } catch {
    // Se intenta con MyMemory.
  }
  try {
    const source: Lang = from ?? (to === 'es' ? 'en' : 'es');
    const translated = (await withSlot(() => requestMyMemory(text, source, to))).trim();
    if (translated && !looksLikeError(translated)) return translated;
  } catch {
    // Sin traducción: se conserva el original.
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

interface PendingLine {
  index: number;
  text: string;
  from: Lang | null;
}

function chunkLines(items: PendingLine[], maxLength: number): PendingLine[][] {
  const chunks: PendingLine[][] = [];
  let current: PendingLine[] = [];
  let length = 0;
  for (const item of items) {
    const add = item.text.length + 1;
    if (current.length && length + add > maxLength) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(item);
    length += add;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function translateBlock(block: PendingLine[], from: Lang, to: Lang): Promise<string[]> {
  if (block.length === 1) {
    return [await translateOne(block[0].text, from, to)];
  }
  try {
    const joined = block.map((line) => line.text).join('\n');
    const reply = await withSlot(() => requestGoogle(joined, from, to));
    const parts = reply.text.split('\n');
    if (parts.length === block.length) {
      return parts.map((part, i) => {
        const text = part.trim();
        return text || block[i].text;
      });
    }
  } catch {
    // Se traduce línea por línea.
  }
  return Promise.all(block.map((line) => translateOne(line.text, from, to)));
}

/**
 * Traduce una lista de líneas manteniendo el orden. Devuelve la misma cantidad
 * de elementos; las líneas que ya están en el idioma destino (o que no tienen
 * letras) se devuelven sin cambios.
 */
export async function translateLines(lines: string[], to: Lang): Promise<string[]> {
  const out = [...lines];
  const pending: PendingLine[] = [];

  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text || !LETTER_RE.test(text)) return;
    if (!isTranslatable(text)) return;
    const detected = detectLanguage(text);
    if (detected === to) return;
    pending.push({ index, text, from: detected });
  });
  if (!pending.length) return out;

  const known = pending.filter((line) => line.from !== null);
  const unknown = pending.filter((line) => line.from === null);

  const tasks: Promise<void>[] = [];

  for (const lang of ['es', 'en'] as Lang[]) {
    const group = known.filter((line) => line.from === lang);
    for (const block of chunkLines(group, MAX_CHUNK)) {
      tasks.push(
        translateBlock(block, lang, to).then((translated) => {
          block.forEach((line, i) => {
            const text = translated[i]?.trim();
            if (text && text !== line.text) out[line.index] = text;
          });
        })
      );
    }
  }

  for (const block of chunkLines(unknown, MAX_CHUNK)) {
    tasks.push(
      Promise.all(block.map((line) => translateOne(line.text, null, to))).then((translated) => {
        block.forEach((line, i) => {
          const text = translated[i]?.trim();
          if (text && text !== line.text) out[line.index] = text;
        });
      })
    );
  }

  await Promise.all(tasks);
  return out;
}

export async function translateText(text: string, to: string): Promise<string> {
  const target: Lang = to === 'en' ? 'en' : 'es';
  if (!text.trim()) return '';
  const [translated] = await translateLines([text], target);
  return translated;
}
