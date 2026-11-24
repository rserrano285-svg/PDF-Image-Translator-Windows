import React, { useEffect, useRef, useState } from 'react';
import type { RenderedPage } from './services/pdf-render';
import type { TranslatedPage } from './services/pdf-generate';
import './App.css';

const MAX_PAGES = 60;
const CONCURRENT_PAGES = 4; // páginas traducidas en paralelo

type Lang = 'es' | 'en';

interface PdfResult {
  type: 'pdf';
  blobUrl: string;
  downloadName: string;
  pageCount: number;
  totalPages: number;
  texts: string[];
  pageImages: string[];
}

interface ImageResult {
  type: 'image';
  blobUrl: string;
  downloadName: string;
}

type Result = PdfResult | ImageResult;

const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
];

function detectKind(file: File): 'pdf' | 'image' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  return 'image';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function readStoredDarkMode(): boolean {
  try {
    return window.localStorage.getItem('pdfTranslator:dark') === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'pdf' | 'image' | null>(null);
  const [toLang, setToLang] = useState<Lang>('es');
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState<boolean>(readStoredDarkMode);

  useEffect(() => {
    try {
      window.localStorage.setItem('pdfTranslator:dark', String(dark));
    } catch {
      // Sin acceso a localStorage (p. ej. ventana anonima); todo igual.
    }
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.blobUrl);
    };
  }, [result]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setKind(f ? detectKind(f) : null);
    setResult(null);
    setWarning('');
    setStatus('idle');
    setMessage('');
  }

  function browseFiles() {
    inputRef.current?.click();
  }

  function toggleDarkMode() {
    setDark((d) => !d);
  }

  async function translatePdf() {
    if (!file) return;
    setStatus('busy');
    setWarning('');
    setMessage('Leyendo el PDF…');
    try {
      const { renderPdfPages } = await import('./services/pdf-render');
      const { generatePdf } = await import('./services/pdf-generate');
      const { translateText } = await import('./services/translate');

      const buf = await file.arrayBuffer();
      const pages = await renderPdfPages(buf);
      const limited = pages.length > MAX_PAGES;
      const selected = limited ? pages.slice(0, MAX_PAGES) : pages;

      if (limited) {
        setWarning(`El PDF tiene ${pages.length} páginas; se traducen las primeras ${MAX_PAGES}.`);
      }

      // Traduce el texto de cada página (sin perder el formato: la imagen de la
      // página original se conserva y el texto traducido se dibuja sobre ella).
      // Se traducen varias páginas en paralelo para acelerar el proceso.
      setMessage('Traduciendo páginas…');
      const translatePage = async (page: RenderedPage): Promise<TranslatedPage> => {
        const items = [];
        for (const item of page.textItems) {
          // eslint-disable-next-line no-await-in-loop
          const translated = await translateText(item.str, toLang);
          items.push({ str: translated, x: item.x, y: item.y, height: item.height });
        }
        return { image: page.image, pageWidth: page.pageWidth, pageHeight: page.pageHeight, items };
      };

      const translatedPages: TranslatedPage[] = [];
      for (let i = 0; i < selected.length; i += CONCURRENT_PAGES) {
        const batch = selected.slice(i, i + CONCURRENT_PAGES);
        // eslint-disable-next-line no-await-in-loop
        const batchResults = await Promise.all(batch.map((p) => translatePage(p)));
        translatedPages.push(...batchResults);
      }

      setMessage('Generando el PDF traducido…');
      const blob = await generatePdf(translatedPages);
      const pageImages = (await renderPdfPages(await blob.arrayBuffer())).map((p) => p.image);

      setResult({
        type: 'pdf',
        blobUrl: URL.createObjectURL(blob),
        downloadName: file.name.replace(/\.pdf$/i, '') + '_traducido.pdf',
        pageCount: selected.length,
        totalPages: pages.length,
        texts: translatedPages.map((p) => p.items.map((i) => i.str).join('\n')),
        pageImages,
      });
      setMessage('');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function translateImage() {
    if (!file) return;
    setStatus('busy');
    setWarning('');
    setMessage('Reconociendo y traduciendo el texto de la imagen…');
    try {
      const { translateImageToCanvas, canvasToBlob } = await import('./services/image-translate');
      const { canvas } = await translateImageToCanvas(file);
      const blob = await canvasToBlob(canvas, file.type || 'image/png');
      setResult({
        type: 'image',
        blobUrl: URL.createObjectURL(blob),
        downloadName: file.name,
      });
      setMessage('');
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Traductor de PDF e imágenes</h1>
          <p className="sub">
            Traduce PDFs de hasta {MAX_PAGES} páginas y imágenes; el resultado conserva el formato
            original.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn secondary" onClick={toggleDarkMode}>
            {dark ? 'Modo claro' : 'Modo oscuro'}
          </button>
        </div>
      </header>

      <main className="card">
        <section className="drop-zone">
          <label className="file-input">
            <input ref={inputRef} type="file" accept="application/pdf,image/*" onChange={onFileChange} />
            {file ? (
              <span className="file-meta">
                <strong>{file.name}</strong>
                <span className="size">
                  {formatBytes(file.size)} · {detectKind(file) === 'pdf' ? 'PDF' : 'Imagen'}
                </span>
              </span>
            ) : (
              <span className="hint">Arrastra un archivo aquí o haz clic para elegirlo</span>
            )}
          </label>
          <button type="button" className="btn secondary" onClick={browseFiles}>
            Examinar archivo…
          </button>
        </section>

        <div className="actions">
          {kind === 'pdf' && (
            <button type="button" className="btn primary" onClick={translatePdf} disabled={status === 'busy'}>
              {status === 'busy' ? 'Traduciendo…' : 'Traducir PDF'}
            </button>
          )}
          {kind === 'image' && (
            <button type="button" className="btn primary" onClick={translateImage} disabled={status === 'busy'}>
              {status === 'busy' ? 'Traduciendo…' : 'Traducir imagen'}
            </button>
          )}
        </div>

        <div className="lang-row">
          <label className="lang-label" htmlFor="to-lang">
            Idioma de destino
          </label>
          <select id="to-lang" value={toLang} onChange={(e) => setToLang(e.target.value as Lang)}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {status === 'busy' && <p className="msg">{message}</p>}
        {status === 'error' && <p className="msg error">{message}</p>}
        {warning && <p className="msg warning">{warning}</p>}

        {result &&
          (result.type === 'pdf' ? (
            <section className="result">
              <div className="result-head">
                <h2>PDF traducido</h2>
                <a className="btn download" href={result.blobUrl} download={result.downloadName}>
                  Guardar PDF traducido ({result.pageCount}
                  {result.totalPages > result.pageCount ? ` de ${result.totalPages}` : ''})
                </a>
              </div>
              {result.pageImages && result.pageImages.length > 0 && (
                <div className="preview-scroll">
                  <h3>Vista previa</h3>
                  {result.pageImages.map((src, i) => (
                    <img key={i} className="pdf-page-preview" src={src} alt={`Página ${i + 1}`} />
                  ))}
                </div>
              )}
              {result.texts.map((t, i) => (
                <details key={i} className="page-text">
                  <summary>Página {i + 1}</summary>
                  <p>{t}</p>
                </details>
              ))}
            </section>
          ) : (
            <section className="result">
              <div className="result-head">
                <h2>Imagen traducida</h2>
                <a className="btn download" href={result.blobUrl} download={result.downloadName}>
                  Guardar imagen traducida
                </a>
              </div>
              <p className="muted">El texto traducido se dibujó sobre el original.</p>
              <img className="preview" src={result.blobUrl} alt="Imagen traducida" />
            </section>
          ))}
      </main>
    </div>
  );
}
