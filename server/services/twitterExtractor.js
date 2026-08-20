/**
 * Twitter / X Media Extractor Service
 * Extracts metadata, author info, and direct MP4/GIF video streams from Twitter/X tweets.
 */

function extractTweetId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // If already a numeric ID
  if (/^\d{5,25}$/.test(trimmed)) {
    return trimmed;
  }

  // Regex matching various Twitter / X URL formats
  const match = trimmed.match(/(?:twitter\.com|x\.com|fixupx\.com|vxtwitter\.com|fxtwitter\.com)\/(?:#!\/)?(?:[a-zA-Z0-9_]+)\/status(?:es)?\/(\d+)/i)
    || trimmed.match(/(?:twitter\.com|x\.com)\/i\/(?:web\/)?status\/(\d+)/i)
    || trimmed.match(/\/status\/(\d+)/i);

  return match ? match[1] : null;
}

function calculateSyndicationToken(id) {
  try {
    const num = Number(id);
    if (isNaN(num)) return 'a';
    return ((num / 1e15) * Math.PI).toString(64 * 0.38196601125).replace(/(0+|\.)/g, '') || 'a';
  } catch (e) {
    return 'a';
  }
}

/**
 * Method 1: Syndication CDN API (twimg)
 */
async function extractFromSyndication(tweetId) {
  const token = calculateSyndicationToken(tweetId);
  const syndicationUrls = [
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`,
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=a`
  ];

  for (const url of syndicationUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://platform.twitter.com/'
        }
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (!data || !data.id_str) continue;

      const mediaList = data.mediaDetails || [];
      const videoMedia = mediaList.find(m => m.type === 'video' || m.type === 'animated_gif') || data.video;

      if (!videoMedia && mediaList.length === 0) {
        return null;
      }

      let isGif = false;
      let variants = [];
      let duration = 0;
      let width = 0;
      let height = 0;
      let thumbnailUrl = '';

      if (videoMedia) {
        isGif = videoMedia.type === 'animated_gif' || (data.text && /pic\.twitter\.com/.test(data.text) && videoMedia.video_info?.variants?.length === 1);
        thumbnailUrl = videoMedia.media_url_https || (data.photos && data.photos[0]?.url) || '';
        
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
              .map(v => ({
                bitrate: v.bitrate || 0,
                contentType: v.content_type,
                url: v.url
              }))
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          }
        }
      }

      const bestVideoUrl = variants.length > 0 ? variants[0].url : null;

      return {
        source: 'syndication',
        id: data.id_str,
        url: `https://x.com/${data.user?.screen_name || 'i'}/status/${data.id_str}`,
        text: data.text || '',
        createdAt: data.created_at || '',
        author: {
          name: data.user?.name || 'Twitter User',
          screen_name: data.user?.screen_name || '',
          avatar_url: data.user?.profile_image_url_https || data.user?.profile_image_url || ''
        },
        mediaType: isGif ? 'animated_gif' : (bestVideoUrl ? 'video' : 'photo'),
        isGif,
        duration,
        width,
        height,
        thumbnailUrl,
        variants,
        bestVideoUrl
      };
    } catch (err) {
      // Try next
    }
  }

  return null;
}

/**
 * Method 2: FxTwitter API
 */
async function extractFromFxTwitter(tweetId) {
  const urls = [
    `https://api.fxtwitter.com/status/${tweetId}`,
    `https://api.fxtwitter.com/i/status/${tweetId}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) continue;
      const json = await res.json();
      if (!json || json.code !== 200 || !json.tweet) continue;

      const tweet = json.tweet;
      const media = tweet.media || {};
      const videos = media.videos || [];
      const photos = media.photos || [];

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
      } else if (photos.length > 0) {
        thumbnailUrl = photos[0].url || '';
      }

      return {
        source: 'fxtwitter',
        id: tweet.id || tweetId,
        url: tweet.url || `https://x.com/i/status/${tweetId}`,
        text: tweet.text || '',
        createdAt: tweet.created_at || '',
        author: {
          name: tweet.author?.name || 'Twitter User',
          screen_name: tweet.author?.screen_name || '',
          avatar_url: tweet.author?.avatar_url || ''
        },
        mediaType: isGif ? 'animated_gif' : (bestVideoUrl ? 'video' : 'photo'),
        isGif,
        duration,
        width,
        height,
        thumbnailUrl,
        variants: bestVideoUrl ? [{ bitrate: 0, contentType: 'video/mp4', url: bestVideoUrl }] : [],
        bestVideoUrl
      };
    } catch (err) {
      // Continue
    }
  }

  return null;
}

/**
 * Method 3: VxTwitter API
 */
async function extractFromVxTwitter(tweetId) {
  const urls = [
    `https://api.vxtwitter.com/Twitter/status/${tweetId}`,
    `https://api.vxtwitter.com/x/status/${tweetId}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });

      if (!res.ok) continue;
      const text = await res.text();
      if (text.startsWith('<')) continue; // HTML error page
      const data = JSON.parse(text);

      if (!data || !data.conversationID) continue;

      let bestVideoUrl = null;
      let isGif = false;
      let thumbnailUrl = '';
      let width = 0;
      let height = 0;

      if (Array.isArray(data.media_extended) && data.media_extended.length > 0) {
        const item = data.media_extended.find(m => m.type === 'video' || m.type === 'gif') || data.media_extended[0];
        if (item.type === 'video' || item.type === 'gif') {
          bestVideoUrl = item.url;
          thumbnailUrl = item.thumbnail_url || '';
          width = item.size?.width || 0;
          height = item.size?.height || 0;
          isGif = item.type === 'gif';
        } else {
          thumbnailUrl = item.url;
        }
      } else if (Array.isArray(data.mediaURLs) && data.mediaURLs.length > 0) {
        const videoLink = data.mediaURLs.find(u => u.endsWith('.mp4') || u.includes('video.twimg.com'));
        if (videoLink) {
          bestVideoUrl = videoLink;
          isGif = videoLink.includes('tweet_video');
        }
      }

      return {
        source: 'vxtwitter',
        id: data.conversationID || tweetId,
        url: `https://x.com/${data.user_screen_name || 'i'}/status/${tweetId}`,
        text: data.text || '',
        createdAt: data.date || '',
        author: {
          name: data.user_name || 'Twitter User',
          screen_name: data.user_screen_name || '',
          avatar_url: ''
        },
        mediaType: isGif ? 'animated_gif' : (bestVideoUrl ? 'video' : 'photo'),
        isGif,
        duration: 0,
        width,
        height,
        thumbnailUrl,
        variants: bestVideoUrl ? [{ bitrate: 0, contentType: 'video/mp4', url: bestVideoUrl }] : [],
        bestVideoUrl
      };
    } catch (err) {
      // Continue
    }
  }

  return null;
}

/**
 * Main Tweet extraction entrypoint with automatic failover
 */
async function extractTweetMedia(tweetInput) {
  const tweetId = extractTweetId(tweetInput);
  if (!tweetId) {
    throw new Error('Link do Twitter/X inválido. Certifique-se de inserir um link como https://x.com/usuario/status/123456...');
  }

  let result = null;

  // Try Syndication first (fastest and most accurate official metadata)
  try {
    result = await extractFromSyndication(tweetId);
  } catch (e) {
    console.warn(`[Extractor] Syndication failed for ${tweetId}:`, e.message);
  }

  // Fallback to FxTwitter
  if (!result || !result.bestVideoUrl) {
    try {
      const fxResult = await extractFromFxTwitter(tweetId);
      if (fxResult && fxResult.bestVideoUrl) {
        result = fxResult;
      }
    } catch (e) {
      console.warn(`[Extractor] FxTwitter failed for ${tweetId}:`, e.message);
    }
  }

  // Fallback to VxTwitter
  if (!result || !result.bestVideoUrl) {
    try {
      const vxResult = await extractFromVxTwitter(tweetId);
      if (vxResult && vxResult.bestVideoUrl) {
        result = vxResult;
      }
    } catch (e) {
      console.warn(`[Extractor] VxTwitter failed for ${tweetId}:`, e.message);
    }
  }

  if (!result) {
    throw new Error('Não foi possível encontrar o Tweet. Verifique se a conta não é privada ou se o tweet foi excluído.');
  }

  if (!result.bestVideoUrl) {
    throw new Error('Este tweet não contém nenhum vídeo ou GIF animado para download/conversão.');
  }

  return result;
}

module.exports = {
  extractTweetId,
  extractTweetMedia
};
