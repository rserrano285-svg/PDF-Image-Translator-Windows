# Changelog — PDF Image Translator Windows

Convención de versiones RS App: cada cambio visible se etiqueta con una V y se registra aquí. El número de versión de `package.json` sigue el mismo orden (0.4.1).

## Corrección — Guardar en Descargas (2026-11-27)

- El botón «Guardar archivo traducido» abre el diálogo con **Descargas** como carpeta inicial; el usuario puede elegir otra si quiere.
- Se eliminaron las etiquetas de versión del nombre visible de la app; las versiones viven aquí y en las notas de release.
- El mockup de diseño se guarda en `docs/pdf-mockup.html`, dentro del proyecto (nada de archivos del programa en Documentos).

## V4 — Colores y formato conservados en imágenes (2026-11-27)

- `src/services/ocr.ts` devuelve también las **palabras** con sus coordenadas (`OcrWord`).
- `src/services/image-translate.ts` agrupa las palabras en líneas, detecta el color de la tinta de cada palabra y divide la línea en tramos de igual color (etiqueta roja + resto blanco).
- El fondo se obtiene del color dominante de la zona: se conservan fondos negros, claros y banners de color, sin rectángulos grises.
- La traducción se ajusta en ancho **y** alto hasta la siguiente línea, evitando que las líneas se pisen.
- Insignia y pie de página actualizados a V4; sin cambios en la traducción de PDFs.

## V3 — Cristal claro (2026-11-27)

- Interfaz cristal claro con acentos azules y gradientes suaves, basada en el mockup `pdf-mockup.html`.
- Modo claro por defecto; el botón de la cabecera alterna a cristal oscuro y guarda la preferencia en `localStorage`.
- Insignia `V3` en la cabecera y texto de versión actualizado en el pie y el README.
- Botones de resultado renombrados a «Guardar PDF traducido» / «Guardar imagen traducida».
- Barra de progreso con indicador animado visible.
- Sin cambios en los servicios de OCR, traducción ni generación de PDF.

## V2 — Cristal oscuro

- Interfaz cristal oscuro, logo renovado, detección de orientación para impresión y enlace de donación.
