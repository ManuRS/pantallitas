# Créditos

## Listas de canales: TDTChannels

Las listas **Tele** y **Radio** de Pantallitas salen de **[TDTChannels](https://github.com/LaQuay/TDTChannels)**, el proyecto de
[LaQuay](https://github.com/LaQuay) y de todas las personas que colaboran con él aportando y corrigiendo enlaces
(ver [sus agradecimientos](https://github.com/LaQuay/TDTChannels/blob/master/AUTHORS.md)). Sin ese trabajo de mantener
a mano cientos de enlaces oficiales al día, esta parte no existiría.

- Proyecto: <https://github.com/LaQuay/TDTChannels> · Web: <https://www.tdtchannels.com/>
- Televisión: <https://www.tdtchannels.com/lists/tv.json>
- Radio: <https://www.tdtchannels.com/lists/radio.json>

Cómo se usan aquí:

- Pantallitas **no incluye copias** de las listas: la página las descarga de tdtchannels.com la primera vez, las guarda
  en tu navegador y, cuando tienen **más de 7 días**, las vuelve a descargar. Si la descarga falla, sigue con la que tenía.
- Si el navegador no deja leer el JSON desde esta web, usa como respaldo el catálogo en Markdown del mismo proyecto,
  [`TELEVISION.md`](https://github.com/LaQuay/TDTChannels/blob/master/TELEVISION.md) y
  [`RADIO.md`](https://github.com/LaQuay/TDTChannels/blob/master/RADIO.md), con los mismos datos.
- Solo se muestran los canales que un navegador puede reproducir (HLS, directos de YouTube y audio); el resto se oculta.
  La conversión está en `catalog.js`.

Licencia y condiciones: el contenido del repositorio de TDTChannels se publica con la
[licencia Apache 2.0](https://github.com/LaQuay/TDTChannels/blob/master/LICENSE), y el uso de los archivos alojados en
tdtchannels.com está sujeto además a su [aviso legal](https://www.tdtchannels.com/aviso-legal/).

TDTChannels no almacena ni emite ninguna señal: solo enlaza las emisiones que ofrecen oficialmente las propias cadenas.
Los derechos de emisión y de contenido son de cada emisora; Pantallitas tampoco retransmite nada, solo muestra esos
enlaces.

## Creator

La lista **Creator** es la lista personal de Pantallitas, con enlaces escritos a mano en `channels.js`. No viene de TDTChannels.

## Puente de sonido de Atresplayer

La idea de resolver el sonido de Antena 3 y La Sexta con un script que corre dentro del reproductor viene de
[tdt-local](https://github.com/cibernicola/tdt-local), de **cibernicola**. Ver [`puente/README.md`](puente/README.md).

## Librerías

- [hls.js](https://github.com/video-dev/hls.js) (Apache 2.0), para reproducir HLS (`.m3u8`) en navegadores que no lo
  traen de serie.

## Reproductor HLS: hls.js

Las cadenas en HLS (`.m3u8`) se reproducen con **[hls.js](https://github.com/video-dev/hls.js)** (versión 1.7.4), copiado
tal cual en [`vendor/hls.min.js`](vendor/hls.min.js) para tener una versión fija y no depender de un CDN. Se publica con la
[licencia Apache 2.0](vendor/hls.js.LICENSE).
