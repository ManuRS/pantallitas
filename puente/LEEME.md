# Puente de sonido de Pantallitas con Atresplayer

Antena 3 y La Sexta se ven con el reproductor oficial de Atresplayer, que es de otro dominio: sin ayuda, Pantallitas
no puede silenciarlo y sonarían todas a la vez. Este puente es un script diminuto que corre **dentro** del reproductor y
obedece un único mensaje de Pantallitas («silencia» o «suena a este volumen»). Con él, solo suena la pantallita con foco.

Es opcional: sin él, Antena 3 y La Sexta se ven igual, pero su sonido no se controla desde Pantallitas.

## Lo que NO hace

- No hace peticiones ni descarga nada.
- No toca, salta ni bloquea la publicidad.
- No lee nada de la página, de tu cuenta ni de otras pestañas.
- No pide permisos (el `manifest.json` no declara `permissions`).
- Solo se ejecuta en `https://www.atresplayer.com/embed/live/*` y solo obedece a Pantallitas
  (`https://manurs.github.io` o `localhost`).

## Instalarlo (Chrome, Edge, Brave y otros Chromium)

En el navegador donde abres Pantallitas:

1. Descarga esta carpeta `puente` (los dos archivos: `manifest.json` y `puente-pantallitas.user.js`).
2. Abre `chrome://extensions` (o `brave://extensions`, `edge://extensions`) y activa el **Modo de desarrollador**.
3. **Cargar descomprimida** y elige la carpeta `puente`.
4. Recarga Pantallitas.

Alternativa: pega `puente-pantallitas.user.js` en Tampermonkey o Violentmonkey (en versiones recientes hay que activar
«Permitir scripts de usuario» en los detalles de la extensión).

## Cómo saber que funciona

El aviso de abajo de la pantallita de Atresplayer cambia de «…sin el puente su sonido no se controla desde aquí» a solo
«Pulsa «Directo» dentro del reproductor», y la barra muestra 🔊 o 🔇.
