/**
 * @file background.js
 * @description Service Worker (Manifest V3) — Núcleo de lógica persistente da extensão.
 *
 * Responsabilidades:
 *   1. Receber mensagens do popup via chrome.runtime.onMessage
 *   2. Executar chamadas de rede a APIs externas (bypass CORS)
 *   3. Retornar dados estruturados ao popup (Vídeos, GIFs e Imagens)
 *
 * Ações suportadas:
 *   - EXTRACT_MEDIA: Extrai metadados, URLs de vídeo, GIF ou fotos de um tweet (cascata de providers)
 *   - FETCH_VIDEO / FETCH_MEDIA: Baixa mídia remota e retorna como base64 (bypass CORS)
 */

// =============================================================================
// CONSTANTES E CONFIGURAÇÃO
// =============================================================================

/** Timeout padrão para requisições de rede (ms) */
const NETWORK_TIMEOUT_MS = 30000;

/** User-Agent simulado para evitar bloqueio de APIs */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =============================================================================
// UTILITÁRIOS DE REDE
// =============================================================================

/**
 * Executa um fetch com timeout via AbortController.
 * @param {string} url - URL de destino
 * @param {Object} [options={}] - Opções do fetch
 * @param {number} [timeoutMs=NETWORK_TIMEOUT_MS] - Timeout em ms
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, image/*, video/*',
        ...(options.headers || {})
      }
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// =============================================================================
// EXTRAÇÃO DE TWEET ID
// =============================================================================

/**
 * Extrai o ID numérico do tweet a partir de uma URL ou string numérica.
 * @param {string} input - URL do tweet ou ID numérico direto
 * @returns {string|null} ID do tweet ou null se inválido
 */
function extractTweetId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // Se já é um ID numérico
  if (/^\d{5,25}$/.test(trimmed)) return trimmed;

  // Regex para múltiplos formatos de URL do Twitter/X
  const match =
    trimmed.match(/(?:twitter\.com|x\.com|fixupx\.com|vxtwitter\.com|fxtwitter\.com)\/(?:#!\/)?(?:[a-zA-Z0-9_]+)\/status(?:es)?\/(\d+)/i) ||
    trimmed.match(/(?:twitter\.com|x\.com)\/i\/(?:web\/)?status\/(\d+)/i) ||
    trimmed.match(/\/status\/(\d+)/i);

  return match ? match[1] : null;
}

// =============================================================================
// PROVIDERS DE EXTRAÇÃO DE MÍDIA (VÍDEOS, GIFS E FOTOS)
// =============================================================================

/**
 * Token de autenticação para a Syndication API do Twitter.
 * @param {string} id - ID do tweet
 * @returns {string} Token calculado
 */
function calculateSyndicationToken(id) {
  try {
    const num = Number(id);
    if (isNaN(num)) return 'a';
    return ((num / 1e15) * Math.PI).toString(64 * 0.38196601125).replace(/(0+|\.)/g, '') || 'a';
  } catch {
    return 'a';
  }
}

/**
 * Provider 1: Syndication CDN API (twimg) — mais rápido e metadados oficiais.
 * @param {string} tweetId
 * @returns {Promise<Object|null>}
 */
async function extractFromSyndication(tweetId) {
  const token = calculateSyndicationToken(tweetId);
  const urls = [
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`,
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`
  ];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'Referer': 'https://platform.twitter.com/' }
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (!data || !data.id_str) continue;

      const mediaList = data.mediaDetails || [];
      const videoMedia = mediaList.find(m => m.type === 'video' || m.type === 'animated_gif') || data.video;
      const photos = mediaList.filter(m => m.type === 'photo').map(m => m.media_url_https);

      if (!videoMedia && photos.length === 0) return null;

      let isGif = false;
      let variants = [];
      let duration = 0;
      let width = 0;
      let height = 0;
      let thumbnailUrl = '';
      let bestVideoUrl = null;

      if (videoMedia) {
        isGif = videoMedia.type === 'animated_gif';
        thumbnailUrl = videoMedia.media_url_https || '';

        if (videoMedia.original_info) {
          width = videoMedia.original_info.width || 0;
          height = videoMedia.original_info.height || 0;
        }

        if (videoMedia.video_info) {
          if (videoMedia.video_info.duration_millis) {
            duration = videoMedia.video_info.duration_millis / 1000;
          }
          if (Array.isArray(videoMedia.video_info.variants)) {
            variants = videoMedia.video_info.variants
              .filter(v => v.content_type === 'video/mp4' && v.url)
              .map(v => ({ bitrate: v.bitrate || 0, url: v.url }))
              .sort((a, b) => b.bitrate - a.bitrate);
          }
        }

        bestVideoUrl = variants.length > 0 ? variants[0].url : null;
      }

      const mediaType = isGif ? 'animated_gif' : (bestVideoUrl ? 'video' : 'photo');
      const bestImageUrl = photos.length > 0 ? photos[0] : null;

      return {
        source: 'syndication',
        id: data.id_str,
        text: data.text || '',
        author: {
          name: data.user?.name || 'Twitter User',
          screen_name: data.user?.screen_name || '',
          avatar_url: data.user?.profile_image_url_https || ''
        },
        mediaType,
        isGif,
        duration,
        width,
        height,
        thumbnailUrl: thumbnailUrl || bestImageUrl || '',
        variants,
        bestVideoUrl,
        bestImageUrl,
        photos
      };
    } catch {
      // Próximo URL
    }
  }
  return null;
}

/**
 * Provider 2: FxTwitter API.
 * @param {string} tweetId
 * @returns {Promise<Object|null>}
 */
async function extractFromFxTwitter(tweetId) {
  const urls = [
    `https://api.fxtwitter.com/status/${tweetId}`,
    `https://api.fxtwitter.com/i/status/${tweetId}`
  ];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;

      const json = await res.json();
      if (!json || json.code !== 200 || !json.tweet) continue;

      const tweet = json.tweet;
      const media = tweet.media || {};
      const videos = media.videos || [];
      const photos = (media.photos || []).map(p => p.url);

      let bestVideoUrl = null;
      let isGif = false;
      let thumbnailUrl = '';
      let width = 0;
      let height = 0;
      let duration = 0;

      if (videos.length > 0) {
        const v = videos[0];
        bestVideoUrl = v.url;
        thumbnailUrl = v.thumbnail_url || '';
        width = v.width || 0;
        height = v.height || 0;
        duration = v.duration || 0;
        isGif = v.type === 'gif' || v.format === 'gif';
      }

      if (!bestVideoUrl && photos.length === 0) continue;

      const mediaType = isGif ? 'animated_gif' : (bestVideoUrl ? 'video' : 'photo');
      const bestImageUrl = photos.length > 0 ? photos[0] : null;

      return {
        source: 'fxtwitter',
        id: tweet.id || tweetId,
        text: tweet.text || '',
        author: {
          name: tweet.author?.name || 'Twitter User',
          screen_name: tweet.author?.screen_name || '',
          avatar_url: tweet.author?.avatar_url || ''
        },
        mediaType,
        isGif,
        duration,
        width,
        height,
        thumbnailUrl: thumbnailUrl || bestImageUrl || '',
        variants: bestVideoUrl ? [{ bitrate: 0, url: bestVideoUrl }] : [],
        bestVideoUrl,
        bestImageUrl,
        photos
      };
    } catch {
      // Continua
    }
  }
  return null;
}

/**
 * Provider 3: VxTwitter API.
 * @param {string} tweetId
 * @returns {Promise<Object|null>}
 */
async function extractFromVxTwitter(tweetId) {
  const urls = [
    `https://api.vxtwitter.com/Twitter/status/${tweetId}`,
    `https://api.vxtwitter.com/x/status/${tweetId}`
  ];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;

      const text = await res.text();
      if (text.startsWith('<')) continue; // Página de erro HTML
      const data = JSON.parse(text);
      if (!data || !data.conversationID) continue;

      let bestVideoUrl = null;
      let isGif = false;
      let thumbnailUrl = '';
      let width = 0;
      let height = 0;
      const photos = [];

      if (Array.isArray(data.media_extended) && data.media_extended.length > 0) {
        data.media_extended.forEach(m => {
          if (m.type === 'image') photos.push(m.url);
        });

        const item = data.media_extended.find(m => m.type === 'video' || m.type === 'gif');
        if (item) {
          bestVideoUrl = item.url;
          thumbnailUrl = item.thumbnail_url || '';
          width = item.size?.width || 0;
          height = item.size?.height || 0;
          isGif = item.type === 'gif';
        }
      } else if (Array.isArray(data.mediaURLs) && data.mediaURLs.length > 0) {
        data.mediaURLs.forEach(u => {
          if (u.endsWith('.mp4') || u.includes('video.twimg.com')) {
            bestVideoUrl = u;
            isGif = u.includes('tweet_video');
          } else {
            photos.push(u);
          }
        });
      }

      if (!bestVideoUrl && photos.length === 0) continue;

      const mediaType = isGif ? 'animated_gif' : (bestVideoUrl ? 'video' : 'photo');
      const bestImageUrl = photos.length > 0 ? photos[0] : null;

      return {
        source: 'vxtwitter',
        id: data.conversationID || tweetId,
        text: data.text || '',
        author: {
          name: data.user_name || 'Twitter User',
          screen_name: data.user_screen_name || '',
          avatar_url: ''
        },
        mediaType,
        isGif,
        duration: 0,
        width,
        height,
        thumbnailUrl: thumbnailUrl || bestImageUrl || '',
        variants: bestVideoUrl ? [{ bitrate: 0, url: bestVideoUrl }] : [],
        bestVideoUrl,
        bestImageUrl,
        photos
      };
    } catch {
      // Continua
    }
  }
  return null;
}

// =============================================================================
// ORQUESTRADOR DE EXTRAÇÃO (CASCATA COM FALLBACK)
// =============================================================================

/**
 * Tenta extrair mídia (vídeos, GIFs ou imagens) de um tweet usando múltiplos providers em cascata.
 * Ordem: Syndication → FxTwitter → VxTwitter
 *
 * @param {string} tweetInput - URL ou ID do tweet
 * @returns {Promise<Object>} Dados da mídia extraída
 */
async function extractTweetMedia(tweetInput) {
  const tweetId = extractTweetId(tweetInput);
  if (!tweetId) {
    throw new Error('Link do Twitter/X inválido. Insira um link como https://x.com/usuario/status/123456...');
  }

  let result = null;

  // Provider 1: Syndication (mais rápido, metadados oficiais)
  try {
    result = await extractFromSyndication(tweetId);
  } catch (e) {
    console.warn('[BG] Syndication falhou:', e.message);
  }

  // Provider 2: FxTwitter (fallback)
  if (!result || (!result.bestVideoUrl && !result.bestImageUrl)) {
    try {
      const fxResult = await extractFromFxTwitter(tweetId);
      if (fxResult && (fxResult.bestVideoUrl || fxResult.bestImageUrl)) result = fxResult;
    } catch (e) {
      console.warn('[BG] FxTwitter falhou:', e.message);
    }
  }

  // Provider 3: VxTwitter (fallback)
  if (!result || (!result.bestVideoUrl && !result.bestImageUrl)) {
    try {
      const vxResult = await extractFromVxTwitter(tweetId);
      if (vxResult && (vxResult.bestVideoUrl || vxResult.bestImageUrl)) result = vxResult;
    } catch (e) {
      console.warn('[BG] VxTwitter falhou:', e.message);
    }
  }

  if (!result) {
    throw new Error('Não foi possível encontrar o Tweet. Verifique se a conta não é privada ou se o post foi excluído.');
  }

  if (!result.bestVideoUrl && !result.bestImageUrl && (!result.photos || result.photos.length === 0)) {
    throw new Error('Este tweet não contém nenhuma mídia (vídeo, GIF ou imagem) para conversão/download.');
  }

  return result;
}

// =============================================================================
// DOWNLOAD DE MÍDIA UNIFICADO (BYPASS CORS)
// =============================================================================

/**
 * Baixa qualquer mídia remota (vídeo MP4, GIF animado ou imagem PNG/JPG/WEBP)
 * e retorna como base64 data URI para contornar CORS no popup.
 *
 * @param {string} mediaUrl - URL da mídia
 * @returns {Promise<string>} Data URI (base64)
 */
async function fetchMediaAsBase64(mediaUrl) {
  const res = await fetchWithTimeout(mediaUrl, {
    headers: { 'Accept': '*/*' }
  }, 60000);

  if (!res.ok) {
    throw new Error(`Falha ao baixar mídia: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Converte ArrayBuffer para base64 em chunks
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  const base64 = btoa(binary);
  const mimeType = res.headers.get('Content-Type') || (mediaUrl.endsWith('.png') ? 'image/png' : 'video/mp4');
  return `data:${mimeType};base64,${base64}`;
}

// =============================================================================
// MESSAGE LISTENER (PONTE COM O POPUP)
// =============================================================================

/**
 * Listener central de mensagens do popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  if (action === 'EXTRACT_MEDIA') {
    extractTweetMedia(payload.tweetUrl)
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(err => {
        console.error('[BG] Erro na extração:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  if (action === 'FETCH_VIDEO' || action === 'FETCH_MEDIA') {
    const url = payload.mediaUrl || payload.videoUrl;
    fetchMediaAsBase64(url)
      .then(dataUri => {
        sendResponse({ success: true, dataUri });
      })
      .catch(err => {
        console.error('[BG] Erro no download de mídia:', err.message);
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }

  sendResponse({ success: false, error: `Ação desconhecida: ${action}` });
  return false;
});

console.log('[LeaFFMPEG] Service Worker inicializado com suporte a Vídeos, GIFs e Imagens.');
