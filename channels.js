// «Creator»: la lista personal, con los enlaces a mano (no se lee de ningún JSON ni lleva estrellas).
// Las listas Tele y Radio vienen de TDTChannels: ver catalog.js y CREDITOS.md.
//
// Lista de cadenas disponibles.
//  - type "hls":     url a un .m3u8 (se reproduce con hls.js / HLS nativo en Safari)
//  - type "youtube": channelId del canal (se incrusta su directo)
//  - type "atres":   slug del canal en Atresplayer (se incrusta su reproductor oficial; sin control de volumen)
//  - type "audio":   url a un stream de solo audio (mp3/aac); se muestra un ecualizador
//  - sin url / channelId / slug => cadena pendiente (aparece deshabilitada en la lista)
//  - note (opcional): texto pequeño que se muestra junto al nombre en la lista
const CHANNELS = [
  {
    id: "la1",
    name: "La 1",
    type: "hls",
    url: "https://rtvelivestream.rtve.es/rtvesec/la1/la1_main_dvr.m3u8",
  },
  {
    id: "24h",
    name: "24h",
    type: "hls",
    url: "https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8",
  },
  // Atresplayer: se incrusta su reproductor oficial (hay que aceptar sus términos y pulsar «Directo»)
  { id: "antena3", name: "Antena 3", type: "atres", slug: "antena3" },
  { id: "la-sexta", name: "La Sexta", type: "atres", slug: "lasexta" },
  {
    // Sin HLS: emite en directo por su canal de YouTube (@la_septima_tv); este enlace lleva siempre a su directo actual
    id: "la-septima",
    name: "La Séptima",
    type: "youtube",
    channelId: "UCOCGPFW1UqPP9zdol7vEK1A",
  },
  {
    id: "tv3",
    name: "TV3",
    type: "hls",
    url: "https://directes3-tv-cat.3catdirectes.cat/live-content/tv3-hls/master.m3u8",
  },
  {
    id: "3cat-info",
    name: "3CatInfo",
    type: "hls",
    url: "https://directes-tv-cat.3catdirectes.cat/live-content/canal324-hls/master.m3u8",
  },
  {
    id: "cnn",
    name: "CNN",
    type: "hls",
    url: "https://ds2c506obo7m8.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-7zjq3tdqasbg8/index.m3u8",
  },
  {
    id: "sky-news",
    name: "Sky News",
    type: "hls",
    url: "https://dqco14bu26p3z.cloudfront.net/30505/89006005/hls/master.m3u8?ads.xumo_channelId=89006005&ads.xumo_streamId=89006005",
  },
  {
    id: "cbs",
    name: "CBS News",
    type: "hls",
    url: "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8",
  },
  {
    // Directo de YouTube de ABC News (EE. UU.), el mismo de la lista Tele de TDTChannels
    id: "abc-news",
    name: "ABC News",
    type: "youtube",
    channelId: "UCBi2mrWuNuyYy4gbM6fU18Q",
  },
  {
    // Directo de YouTube de NBC News (EE. UU.), el de la lista Tele de TDTChannels
    id: "nbc-news",
    name: "NBC News",
    type: "youtube",
    channelId: "UCeY0bbntWzzVIaj2z3QigXg",
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    type: "hls",
    url: "https://www.bloomberg.com/media-manifest/streams/us.m3u8",
  },
  {
    id: "el-pais",
    name: "El País",
    type: "hls",
    url: "https://d2epgk1fomaa1g.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-9n8y4tw0bk3an/live/fast-channel-el-pais/fast-channel-el-pais.m3u8",
  },
  {
    // Solo audio (StreamTheWorld). Sin probar desde aquí: si no suena, se borra esta entrada
    id: "ser-radio",
    name: "SER • Radio (solo sonido)",
    type: "audio",
    url: "https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3",
  },
  {
    // El canal no permite incrustar este directo: la pantalla ofrece abrirlo en YouTube
    id: "ser",
    name: "SER • Video (enlace youtube)",
    type: "youtube",
    channelId: "UCQ2Fej5pr1ipVeBWTX8Sc_Q",
  },
];
