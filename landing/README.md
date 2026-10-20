# Landing de Faro

Sitio estático en español, adaptable a móvil y escritorio. No necesita Node ni un proceso de servidor: el contenido de esta carpeta se puede servir desde cualquier hosting estático.

## Archivos

- `index.html`: landing y sus enlaces de descarga, código y donación.
- `styles.css`: estilos adaptables.
- `assets/`: capturas y favicon.

## Publicación

Subir el contenido completo de `landing/` a la carpeta pública del hosting, conservando la estructura `assets/`. Las rutas son relativas, así que la página también funciona dentro de una subcarpeta. No copiar `landing/` encima del directorio público de Don Antonio sin confirmar antes si ese servidor aloja una página independiente o si hay que montarla bajo una ruta propia.

## Enlaces actuales

- Descargas y repositorio: `https://github.com/pauloabrate-prog/faro`
- Donaciones: `https://paypal.me/pauloabrate`
- Guía de Faro Live Studio: `https://github.com/pauloabrate-prog/faro/blob/main/LIVE-STREAMING.md`

El botón lleva a la página de lanzamientos publicada en GitHub. La landing puede publicarse por separado, pero conviene actualizar el release público con el instalador 1.7.2 antes de anunciar que esa versión ya está disponible para descargar.
