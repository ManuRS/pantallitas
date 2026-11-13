# Pruebas de Pantallitas

Abren la web en un Chrome sin interfaz y comprueban que todo hace lo que debe. No tocan ninguna cadena real: la «tele» y
la «radio» son streams HLS en directo que genera ffmpeg en tu máquina, y YouTube, Atresplayer y TDTChannels se sustituyen
por versiones de pega (Atresplayer lleva dentro el puente de sonido de verdad).

## Qué hace falta

- [Node.js](https://nodejs.org/) 18 o posterior
- [ffmpeg](https://ffmpeg.org/) con libx264
- Google Chrome instalado (el Chromium que trae Playwright no reproduce H.264/AAC). Si no lo encuentra, dile dónde está
  con `CHROME_PATH=/ruta/a/chrome`

## Cómo se lanzan

```sh
cd tests
npm install
npm test              # todas (unos 5 minutos)
npm run test:rapidas  # solo las rápidas (unos 2 minutos)
npm run test:lentas   # solo las lentas
npm run test:grabar   # solo las de grabar el audio (necesitan también ffprobe, que viene con ffmpeg)
```

`npm test` arranca ffmpeg y un servidor local (puerto 8123; otro con `PORT=...`), pasa las pruebas y lo apaga todo.

## Qué se comprueba

| Fichero | Qué mira |
| --- | --- |
| `rapidas.js` | Arranque, primer gesto y sonido, calidad según el tamaño de la pantallita, teclado y modo foco, la radio fuera de la pantalla grande, YouTube que tarda en estar listo, imagen en imagen de YouTube (con y sin clic en la ventana flotante), arrastres (de la lista y entre pantallitas), puente de Atresplayer (sonido y arranque solo), copia de las cadenas de Tele/Radio cuando TDTChannels las renombra, y «Guardar orden» |
| `lentas.js` | Errores de HLS (manifiesto que falla, cadena muerta, reintentos en sesiones largas, corte de red de 12 s), pestaña oculta (parar y volver al directo) y móvil (deslizar como primer gesto, toque, modo foco) |
| `grabar.js` | Grabar el audio: tele HLS sin foco (y cambiando de calidad a mitad), radio HLS, radio de enlace directo con y sin permiso CORS, tele con audio y vídeo en el mismo trozo MP4, cambiar de cadena grabando y pestaña oculta. Los archivos se comprueban con ffprobe/ffmpeg |

Lo demás es infraestructura: `run.js` lo orquesta, `server.js` sirve el repo y los streams (y sabe provocar fallos) y
`lib.js` tiene los canales de prueba y las utilidades.

## Al tocar las pruebas

- Nada de `page.evaluate` antes del primer gesto en una prueba que dependa de él: Playwright lo ejecuta como si fuera un
  gesto del usuario y el navegador da el sonido por permitido.
- Las pruebas no forman parte de la web: no se cargan desde `index.html`.
