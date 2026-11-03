// Lista de cadenas disponibles.
//  - type "hls":     url a un .m3u8 (se reproduce con hls.js / HLS nativo en Safari)
//  - type "youtube": channelId del canal (se incrusta su directo)
//  - sin url / channelId => cadena pendiente (aparece deshabilitada en la lista)
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
  { id: "la-sexta", name: "La Sexta", type: "hls", url: null }, // pendiente
  { id: "la-septima", name: "La Séptima", type: "hls", url: null }, // pendiente
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
    id: "el-pais",
    name: "El País",
    type: "hls",
    url: "https://d2epgk1fomaa1g.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-9n8y4tw0bk3an/live/fast-channel-el-pais/fast-channel-el-pais.m3u8",
  },
  {
    id: "ser",
    name: "SER",
    type: "youtube",
    channelId: "UCQ2Fej5pr1ipVeBWTX8Sc_Q",
  },
];
