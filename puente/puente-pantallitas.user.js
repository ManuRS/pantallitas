// ==UserScript==
// @name         Pantallitas · puente de sonido con Atresplayer
// @namespace    https://github.com/ManuRS/pantallitas
// @version      1.2.0
// @description  Deja que Pantallitas silencie (y ponga a su volumen) el reproductor incrustado de Atresplayer, y lo arranca solo (pulsa «Aceptar» y «Directo» por ti).
// @match        https://www.atresplayer.com/embed/live/*
// @match        https://atresplayer.com/embed/live/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Para qué sirve: el reproductor de Atresplayer que Pantallitas muestra en una casilla es de otro origen, y el navegador
// no deja que la página toque su sonido. Este script corre DENTRO del reproductor y obedece un único mensaje de
// Pantallitas: «silencia» o «suena a este volumen». Así solo suena la pantallita que tiene el foco.
//
// Además lo arranca solo, como el resto de cadenas: pulsa por ti «Aceptar» en el aviso de cookies de Atresplayer (si
// sale) y después «Directo». OJO: eso es aceptar sus cookies en tu nombre. Si prefieres decidirlo tú, pon
// ACEPTAR_COOKIES a false aquí abajo; y con PULSAR_DIRECTO a false no pulsa nada.
//
// Qué NO hace: no hace peticiones, no toca ni salta la publicidad, no lee nada de tu cuenta y no manda nada fuera de
// tu navegador. Solo habla con la página que incrusta el reproductor, y solo si es Pantallitas.
(function () {
  'use strict';

  // Páginas que pueden darle órdenes (https://manurs.github.io/pantallitas/ y https://pantallitas.pages.dev,
  // y localhost para probar en local)
  const PERMITIDOS = /^(https:\/\/(manurs\.github\.io|pantallitas\.pages\.dev)|https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?)$/i;
  const REAPLICAR_MS = 1000;
  const ACEPTAR_COOKIES = true; // pulsar «Aceptar» en el aviso de cookies de Atresplayer, si sale
  const PULSAR_DIRECTO = true;  // pulsar «Directo» para que la cadena arranque sola

  if (window.parent === window) return; // abierto solo, fuera de Pantallitas: no hace nada

  const origenPadre = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
  if (origenPadre && !PERMITIDOS.test(origenPadre)) return; // lo incrusta otra web: ni caso
  // Firefox no tiene ancestorOrigins: entonces se usa el origen de la página que nos incrusta (document.referrer)
  let origenRef = '';
  try { origenRef = document.referrer ? new URL(document.referrer).origin : ''; } catch (e) { /* sin referrer */ }
  if (!origenPadre && origenRef && !PERMITIDOS.test(origenRef)) return;
  const destino = origenPadre || origenRef || 'https://manurs.github.io';

  let silenciado = false; // lo último que pidió Pantallitas
  let volumen = null;

  const medios = () => document.querySelectorAll('video, audio');

  function aplicar() {
    for (const m of medios()) {
      if (silenciado) {
        if (!m.muted) m.muted = true;
      }
      if (volumen !== null && m.volume !== volumen) m.volume = volumen;
    }
  }

  // el reproductor crea su <video> al pulsar «Directo»: si Pantallitas pidió silencio, nace silenciado
  for (const tipo of ['play', 'playing', 'loadedmetadata', 'volumechange']) {
    document.addEventListener(tipo, () => { if (silenciado) aplicar(); }, true);
  }
  setInterval(() => { if (silenciado) aplicar(); }, REAPLICAR_MS);

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !PERMITIDOS.test(e.origin)) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'pantallitas' || d.type !== 'audio') return;
    const antes = silenciado;
    silenciado = !!d.muted;
    if (typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1) volumen = d.volume;
    if (antes && !silenciado) for (const m of medios()) m.muted = false; // solo devuelve el sonido que él quitó
    aplicar();
  });

  // ---------- Arranque solo ----------
  // El aviso de cookies (Didomi) no sale siempre: una vez aceptado, se queda aceptado. Y puede llegar antes o después
  // que el botón «Directo», así que se vigilan los dos un rato. «Directo» no se pulsa con el aviso delante.
  const VIGILAR_MS = 90000, PASO_MS = 400, REINTENTO_MS = 4000, MAX_DIRECTO = 3;
  const seVe = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const corriendo = () => [...medios()].some((m) => !m.paused && m.currentTime > 0);
  let pulsadoDirecto = 0, ultimoDirecto = 0, ultimoAceptar = 0;
  const inicio = Date.now();

  function arrancar() {
    const ahora = Date.now();
    const aviso = document.getElementById('didomi-notice-agree-button');
    if (seVe(aviso)) {
      if (ACEPTAR_COOKIES && ahora - ultimoAceptar > 2000) { ultimoAceptar = ahora; aviso.click(); }
      return; // con el aviso delante, «Directo» espera (a nosotros o a que lo aceptes tú)
    }
    if (!PULSAR_DIRECTO || pulsadoDirecto >= MAX_DIRECTO || corriendo()) return;
    const directo = document.querySelector('button[aria-label="Directo"]');
    if (seVe(directo) && ahora - ultimoDirecto > REINTENTO_MS) {
      ultimoDirecto = ahora;
      pulsadoDirecto++;
      if (silenciado) aplicar();
      directo.click();
    }
  }
  if (ACEPTAR_COOKIES || PULSAR_DIRECTO) {
    const reloj = setInterval(() => {
      if (Date.now() - inicio > VIGILAR_MS) { clearInterval(reloj); return; } // después ya no toca nada: mandas tú
      arrancar();
    }, PASO_MS);
  }

  // «aquí estoy»: Pantallitas lo usa para saber que el puente está y mandarle el sonido
  window.parent.postMessage({ source: 'pantallitas-bridge', type: 'ready', version: 1 }, destino);
}());
