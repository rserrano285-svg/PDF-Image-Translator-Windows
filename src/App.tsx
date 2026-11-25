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
  /** Texto detectado por OCR en la imagen. */
  ocrText: string;
  /** Texto traducido que se dibujó sobre la imagen. */
  text: string;
}

type Result = PdfResult | ImageResult | null;

function fileThumbUrl(file: File): string {
  try {
    return URL.createObjectURL(file);
  } catch {
    return '';
  }
}

function isImageFile(file: File): boolean {
  return (file.type || '').startsWith('image/');
}

function isPdfFile(file: File): boolean {
  return detectKind(file) === 'pdf';
}

const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
];

function classNames(...parts: (string | Record<string, boolean> | undefined)[]): string {
  const names: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === 'string') {
      names.push(part);
    } else {
      for (const [name, value] of Object.entries(part)) if (value) names.push(name);
    }
  }
  return names.join(' ');
}

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
  const [result, setResult] = useState<Result>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState<boolean>(readStoredDarkMode);
  const [thumbUrl, setThumbUrl] = useState('');
  const thumbRef = useRef('');
  const [dragging, setDragging] = useState(false);

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

  useEffect(
    () => () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    },
    []
  );

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setKind(f ? detectKind(f) : null);
    setResult(null);
    setWarning('');
    setStatus('idle');
    setMessage('');

    if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    thumbRef.current = f ? fileThumbUrl(f) : '';
    setThumbUrl(thumbRef.current);

    if (f && isImageFile(f)) {
      // Al adjuntar una imagen se traduce automáticamente; el usuario ve
      // el resultado en el mismo lugar donde está su archivo.
      setTimeout(() => {
        void translateImage();
      }, 300);
    }
  }

  function onDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) {
      const input = inputRef.current;
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
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
      const { translateLines } = await import('./services/translate');

      const buf = await file.arrayBuffer();
      const pages = await renderPdfPages(buf);
      const limited = pages.length > MAX_PAGES;
      const selected = limited ? pages.slice(0, MAX_PAGES) : pages;

      if (limited) {
        setWarning(`El PDF tiene ${pages.length} páginas; se traducen las primeras ${MAX_PAGES}.`);
      }

      // Traduce el texto de cada página (sin perder el formato: la imagen de la
      // página original se conserva y solo se sustituyen las líneas traducidas).
      // Se traducen varias páginas en paralelo para acelerar el proceso.
      setMessage('Traduciendo páginas…');
      const translatePage = async (page: RenderedPage): Promise<TranslatedPage> => {
        const translated = await translateLines(
          page.textItems.map((item) => item.str),
          toLang
        );
        const items = page.textItems.flatMap((item, index) => {
          const text = (translated[index] ?? '').trim();
          // Si no cambió (ya estaba en el idioma destino) se deja el original.
          if (!text || text === item.str.trim()) return [];
          return [
            {
              str: text,
              x: item.x,
              y: item.y,
              width: item.width,
              maxWidth: item.maxWidth,
              height: item.height,
              background: item.background,
              color: item.color,
            },
          ];
        });
        return { image: page.image, pageWidth: page.pageWidth, pageHeight: page.pageHeight, items };
      };

      const translatedPages: TranslatedPage[] = [];
      for (let i = 0; i < selected.length; i += CONCURRENT_PAGES) {
        const batch = selected.slice(i, i + CONCURRENT_PAGES);
        // eslint-disable-next-line no-await-in-loop
        const batchResults = await Promise.all(batch.map((p) => translatePage(p)));
        translatedPages.push(...batchResults);
        setMessage(`Traduciendo… ${Math.min(i + batch.length, selected.length)}/${selected.length} páginas`);
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
      const { canvas, text, ocrText } = await translateImageToCanvas(file, toLang);
      if (!text.trim()) {
        setWarning('No se encontró texto que traducir en la imagen.');
        setStatus('idle');
        return;
      }
      const blob = await canvasToBlob(canvas, file.type || 'image/png');
      setResult({
        type: 'image',
        blobUrl: URL.createObjectURL(blob),
        downloadName: file.name,
        ocrText,
        text,
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
        <section className="drop-zone" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
          <label className={classNames('drop-zone-label', { dragging })}>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={onFileChange}
            />
            {file ? (
              <span className="file-meta">
                <span className="thumb">
                  {isImageFile(file) && thumbUrl ? (
                    <img src={thumbUrl} alt="" className="thumb-img" />
                  ) : isPdfFile(file) ? (
                    <span className="thumb-icon">📄</span>
                  ) : (
                    <span className="thumb-icon">🖼</span>
                  )}
                </span>
                <span>
                  <strong>{file.name}</strong>
                  <span className="size">
                    {formatBytes(file.size)} · {detectKind(file) === 'pdf' ? 'PDF' : 'Imagen'}
                  </span>
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
              {result.text && (
                <details className="page-text">
                  <summary>Texto traducido</summary>
                  <p>{result.text}</p>
                </details>
              )}
              {result.ocrText && result.ocrText.trim() && (
                <details className="page-text">
                  <summary>Texto detectado por el OCR</summary>
                  <p className="ocr-text">{result.ocrText}</p>
                </details>
              )}
            </section>
          ))}
      </main>
      <footer className="footer">
        <span className="footer-text">
          Código abierto —{' '}
          <a href="https://github.com/rserrano285-svg/pdf_image_traslator" target="_blank" rel="noopener noreferrer">
            Repositorio en GitHub
          </a>
        </span>
      </footer>
    </div>
  );
}
