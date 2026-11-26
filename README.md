# PDF Image Translator V2

App de escritorio (Windows, via Electron) que traduce textos de PDF e imágenes manteniendo el formato original.

- **PDF**: extrae el texto de cada página con `pdf.js` y lo traduce; genera un PDF nuevo con el texto traducido (páginas del mismo tamaño).
- **Imagen**: reconoce el texto con OCR (`tesseract.js`), lo traduce y lo dibuja en la imagen (manteniendo el tipo de imagen original).

## Requisitos

- Node.js v18 o superior (v26 confirmada).
- Windows (el paquete de escritorio se construye con `electron-builder`).

## Instalación

```powershell
npm install
```

## Desarrollo

### App de escritorio

```powershell
npm start        # abre el servidor de desarrollo de CRA (http://localhost:3000)
npm run electron # abre el Electron; carga el servidor si está corriendo, si no el build de producción
```

### Web (sin Electron)

```powershell
npm start
```

## Empaquetar para distribución

```powershell
npm run electron:build
```

El instalador aparece en la carpeta `dist/`.

## Pruebas

```powershell
npm test   # jest de CRA
```

## Dependencias Principales

| Paquete | Uso |
| --- | --- |
| `pdfjs-dist` | Lectura y extracción de texto de PDF |
| `pdf-lib` | Generación del PDF traducido |
| `tesseract.js` | OCR del texto de las imágenes |
| `@vitalets/google-translate-api` | Traducción (Google Translate) |
| `electron`, `electron-builder` | Empaquetado para escritorio |


## Apoyo

Esta app es gratuita y de código abierto. Si te ahorra tiempo, puedes apoyar el desarrollo con una donación voluntaria: [PayPal (rene285serrano)](https://paypal.me/rene285serrano). Cualquier ayuda cuenta.


## V2 — Cristal oscuro

- Interfaz **cristal oscuro** con acentos azules, paneles translúcidos y logo renovado.
- Muestra la **orientación detectada** (horizontal/apaisado o vertical) y ajusta el PDF generado para que se imprima correctamente.
- El modo oscuro está activo por defecto; puedes cambiarlo con el botón de la cabecera.
