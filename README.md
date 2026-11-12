# Pantallitas

Todas las teles a la vez, sin pelearte con el mando: hasta 8 directos (TDT, radio, YouTube) en una sola página, con
modo foco, imagen en imagen y sonido solo en la pantallita que tiene el foco.

- https://pantallitas.pages.dev/ (Cloudflare Pages)
- https://manurs.github.io/pantallitas/ (GitHub Pages, la misma web)

Es una web estática: HTML, CSS y JavaScript sin compilar ni dependencias que instalar (hls.js va copiado en `vendor/`).
Para probarla en local basta cualquier servidor de ficheros, por ejemplo `python3 -m http.server` en esta carpeta.

## Qué hay en cada sitio

| Dónde | Qué es |
| --- | --- |
| `index.html`, `style.css`, `app.js` | La web. Al cambiar el CSS o un `.js`, sube el `?v=N` de todos en `index.html` |
| `channels.js`, `catalog.js` | La lista «Creator» (la tuya) y el catálogo de respaldo de TDTChannels |
| `pip.html` | Página vacía en la que va YouTube dentro de la ventana flotante de imagen en imagen |
| `puente/` | Extensión opcional para Antena 3 y La Sexta: sonido por pantallita y arranque solo. Ver su README |
| `tests/` | Pruebas automáticas en Chrome sin interfaz. Ver su README |
| `tools/` | `node tools/og.js` regenera `og.png`, la imagen de previsualización en redes, desde `tools/og.html` |

## Créditos

Ver [CREDITOS.md](CREDITOS.md): listas de canales de TDTChannels, hls.js y la idea del puente (tdt-local).
