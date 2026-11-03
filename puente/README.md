# Puente de sonido de Pantallitas con Atresplayer

Antena 3 y La Sexta se ven con el reproductor oficial de Atresplayer, que es de otro dominio: sin ayuda, Pantallitas
no puede silenciarlo y sonarían todas a la vez. Este puente es un script diminuto que corre **dentro** del reproductor y
obedece un único mensaje de Pantallitas («silencia» o «suena a este volumen»). Con él, solo suena la pantallita con foco.

Es **opcional**. Sin él, Antena 3 y La Sexta se ven igual, pero Pantallitas mantiene en marcha solo la pantallita de
Atresplayer que tiene el foco (las demás se quedan en «En pausa, pulsa para reanudar») y hay que volver a pulsar
«Directo» cada vez que cambias de una a otra.

## Instalarlo

Hazlo en el navegador donde abres Pantallitas, y recarga Pantallitas al terminar.

### Opción A: Tampermonkey o Violentmonkey (la más rápida)

1. Instala [Tampermonkey](https://www.tampermonkey.net/) o Violentmonkey.
2. Crea un script nuevo y pega todo el contenido de [`puente-pantallitas.user.js`](puente-pantallitas.user.js).
3. En las versiones recientes de Chrome, Edge y Brave hay que activar además **«Permitir scripts de usuario»** en los
   detalles de la extensión (`chrome://extensions`).

### Opción B: extensión sin gestor de scripts (Chrome, Edge, Brave y otros Chromium)

1. Descarga los dos archivos, [`manifest.json`](manifest.json) y [`puente-pantallitas.user.js`](puente-pantallitas.user.js),
   y ponlos juntos en una carpeta (por ejemplo `puente`).
2. Abre `chrome://extensions` (o `brave://extensions`, `edge://extensions`) y activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige esa carpeta.

Chrome puede avisar al arrancar de que hay extensiones de modo desarrollador sin publicar: es lo esperado, porque no
está en ninguna tienda. Para quitarla, usa el botón **Quitar** de la misma pantalla.

> Firefox: usa la opción A (Tampermonkey o Violentmonkey).

## Cómo saber que funciona

Abre Antena 3 o La Sexta en una pantallita. El aviso de abajo de la pantallita dice solo «Pulsa «Directo» dentro del
reproductor» (sin el «Sin el puente de sonido…») y la barra de arriba muestra 🔊 o 🔇. Si instalas el puente con
Pantallitas ya abierto, recarga la página.

## Lo que NO hace

- No hace peticiones ni descarga nada.
- No toca, salta ni bloquea la publicidad.
- No lee nada de la página, de tu cuenta ni de otras pestañas.
- No pide permisos (el `manifest.json` no declara `permissions`).
- Solo se ejecuta en `https://www.atresplayer.com/embed/live/*` y solo obedece a Pantallitas
  (`https://manurs.github.io` o `localhost`); si lo incrusta otra web, no hace nada.

## Cómo funciona

Pantallitas y el puente se hablan con `postMessage`, y cada lado comprueba quién le escribe:

- Del puente a Pantallitas: `{source: "pantallitas-bridge", type: "ready"}`, una vez, al arrancar.
- De Pantallitas al puente: `{source: "pantallitas", type: "audio", muted, volume}`, cada vez que cambia el foco, el
  volumen o el silencio, y cada pocos segundos por si el reproductor recrea su `<video>`.

El puente solo silencia: si Pantallitas pide sonido, quita el silencio que él mismo puso y fija el volumen.

## Crédito

La idea de resolverlo con un script que corre dentro del reproductor de Atresplayer y habla con la página por
`postMessage` viene del puente de **[tdt-local](https://github.com/cibernicola/tdt-local)**, de **cibernicola**, que
fue quien mostró que se podía hacer así. El código de este puente es propio y mucho más pequeño: solo silencia y pone
volumen, sin detectar publicidad ni ecualizar.
