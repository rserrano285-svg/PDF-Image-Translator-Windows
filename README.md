# PDF Image Translator

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


## Versiones

La versión actual está documentada en [CHANGELOG.md](CHANGELOG.md) y en las notas de release del repositorio.

### Colores y formato conservados en imágenes

- El OCR de imágenes trabaja **por palabra** y detecta el color de la tinta de cada una: las etiquetas coloreadas (por ejemplo, rojas sobre fondo negro) conservan su color al traducirse.
- La línea se divide en tramos de igual color; cada tramo se traduce y se dibuja con su color original.
- El fondo se toma del **color dominante de la zona**, con lo que se respetan fondos oscuros, claros y banners de color.
- La fuente se reduce hasta que la traducción cabe en el ancho **y** en la altura disponible hasta la siguiente línea: el texto ya no se pisa.

### Cristal claro

- Interfaz **cristal claro** con acentos azules, paneles translúcidos y fondo con degradados suaves.
- El **modo claro está activo por defecto**; el botón de la cabecera cambia a cristal oscuro y se recuerda la preferencia.
- El botón de resultado dice **Guardar PDF traducido** y muestra el número de páginas.
- La barra de progreso tiene una animación visible durante la traducción.

### V2 — Cristal oscuro

- Interfaz **cristal oscuro** con acentos azules, paneles translúcidos y logo renovado.
- Muestra la **orientación detectada** (horizontal/apaisado o vertical) y ajusta el PDF generado para que se imprima correctamente.
- El modo oscuro estaba activo por defecto; se podía cambiar con el botón de la cabecera.
