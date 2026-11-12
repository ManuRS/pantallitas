# Puente de sonido de Pantallitas con Atresplayer

Antena 3 y La Sexta se ven con el reproductor oficial de Atresplayer, que es de otro dominio: sin ayuda, Pantallitas
no puede silenciarlo y sonarían todas a la vez. Este puente es un script diminuto que corre **dentro** del reproductor y
obedece un único mensaje de Pantallitas («silencia» o «suena a este volumen»). Con él, solo suena la pantallita con foco.

Además **las arranca solas**, como el resto de cadenas: pulsa por ti «Aceptar» en el aviso de cookies de Atresplayer
(solo sale la primera vez) y después «Directo».

> **Ojo:** eso es aceptar las cookies de Atresplayer en tu nombre. Si prefieres decidirlo tú, abre
> `puente-pantallitas.user.js` y pon `ACEPTAR_COOKIES` a `false` (el puente esperará a que contestes al aviso y luego
> pulsará «Directo»). Con `PULSAR_DIRECTO` a `false` no pulsa nada. Después, recarga la extensión.

Es **opcional**. Sin él, Antena 3 y La Sexta se ven igual, pero Pantallitas mantiene en marcha solo la pantallita de
Atresplayer que tiene el foco (las demás se quedan en «En pausa, pulsa para reanudar») y hay que aceptar las cookies
y pulsar «Directo» a mano, también cada vez que cambias de una a otra.

## Instalarlo

Hazlo en el navegador donde abres Pantallitas (Chrome, Edge, Brave y otros Chromium), y recarga Pantallitas al terminar.

1. Descarga los dos archivos, [`manifest.json`](manifest.json) y [`puente-pantallitas.user.js`](puente-pantallitas.user.js),
   y ponlos juntos en una carpeta (por ejemplo `puente`).
2. Abre `chrome://extensions` (o `brave://extensions`, `edge://extensions`) y activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige esa carpeta.

Chrome puede avisar al arrancar de que hay extensiones de modo desarrollador sin publicar: es lo esperado, porque no
está en ninguna tienda. Para quitarla, usa el botón **Quitar** de la misma pantalla.

## Cómo saber que funciona

Abre Antena 3 o La Sexta en una pantallita. Si el puente funciona, no sale el aviso «Sin el puente de sonido…» abajo de
la pantallita y la barra de arriba muestra 🔊 o 🔇. Si instalas el puente con Pantallitas ya abierto, recarga la página.

## Lo que NO hace

- No hace peticiones ni descarga nada.
- No toca, salta ni bloquea la publicidad.
- No lee nada de tu cuenta ni de otras pestañas. De la página solo busca dos botones: «Aceptar» (cookies) y «Directo».
- Solo pulsa esos dos botones, y solo durante el primer minuto y medio de cada carga: después mandas tú.
- No pide permisos (el `manifest.json` no declara `permissions`).
- Solo se ejecuta en `https://www.atresplayer.com/embed/live/*` y solo obedece a Pantallitas
  (`https://manurs.github.io`, `https://pantallitas.pages.dev` o `localhost`); si lo incrusta otra web, no hace nada.

## Cómo funciona

Pantallitas y el puente se hablan con `postMessage`, y cada lado comprueba quién le escribe:

- Del puente a Pantallitas: `{source: "pantallitas-bridge", type: "ready"}`, una vez, al arrancar.
- De Pantallitas al puente: `{source: "pantallitas", type: "audio", muted, volume}`, cada vez que cambia el foco, el
  volumen o el silencio, y cada pocos segundos por si el reproductor recrea su `<video>`.

El puente solo silencia: si Pantallitas pide sonido, quita el silencio que él mismo puso y fija el volumen.

El arranque solo no necesita mensajes: el puente busca el botón del aviso de cookies (`#didomi-notice-agree-button`) y
el de «Directo» (`button[aria-label="Directo"]`) y hace clic en ellos. Si Atresplayer cambia esos botones dejará de
arrancar solo (el sonido seguirá funcionando) y habrá que actualizar el puente.

## Crédito

La idea de resolverlo con un script que corre dentro del reproductor de Atresplayer y habla con la página por
`postMessage` viene del puente de **[tdt-local](https://github.com/cibernicola/tdt-local)**, de **cibernicola**, que
fue quien mostró que se podía hacer así. El código de este puente es propio y mucho más pequeño: silencia, pone
volumen y pulsa «Directo», sin detectar publicidad ni ecualizar.
