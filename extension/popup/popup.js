/**
 * @file popup.js
 * @description Controlador da Interface & Lógica do Discord GIF Machine (Manifest V3).
 *
 * Funcionalidades:
 *   1. Vídeos MP4/WebM -> GIF otimizado para Discord (≤ 8MB) ou Padrão (≤ 20MB)
 *   2. Imagens (PNG/JPG/WEBP) -> GIF estático (com ou sem legenda meme)
 *   3. GIFs animados -> Se ≤ 8MB e sem legenda, download/cópia direta sem recompressão; se > 8MB ou com legenda, comprime e otimiza para ≤ 8MB
 *   4. Legendas Meme em tempo real estilo esmbot (Futura Condensed Extra Bold)
 *   5. Drag & Drop universal e auto-detecção da aba ativa
 */

// =============================================================================
// CONSTANTES & LIMITES DE TAMANHO
// =============================================================================

/** Limites em bytes por modo de conversão */
const LIMITS = {
  discord: 8 * 1024 * 1024,   // 8.0 MB (limite free do Discord)
  standard: 20 * 1024 * 1024  // 20.0 MB (limite Nitro Classic / Padrão)
};

// =============================================================================
// REFERÊNCIAS DOM
// =============================================================================

// Header & Status Badge
const statusBadge = document.getElementById('statusBadge');
const statusBadgeText = document.getElementById('statusBadgeText');

// Mais Opções (Dropdown de Entrada: Link & Dropzone)
const moreOptionsToggleBtn = document.getElementById('moreOptionsToggleBtn');
const moreOptionsDropdown = document.getElementById('moreOptionsDropdown');
const moreOptionsBtnText = document.getElementById('moreOptionsBtnText');
const urlForm = document.getElementById('urlForm');
const tweetUrlInput = document.getElementById('tweetUrlInput');
const pasteBtn = document.getElementById('pasteBtn');
const fetchBtn = document.getElementById('fetchBtn');
const dropzone = document.getElementById('dropzone');
const localFileInput = document.getElementById('localFileInput');

// Mode Switcher (Segmented Control)
const activeModeBadge = document.getElementById('activeModeBadge');
const modeDiscordBtn = document.getElementById('modeDiscordBtn');
const modeStandardBtn = document.getElementById('modeStandardBtn');
const mediaSelector = document.getElementById('mediaSelector');

// Preview & Metadata
const previewContainer = document.getElementById('previewContainer');
const tweetMetaBar = document.getElementById('tweetMetaBar');
const authorAvatar = document.getElementById('authorAvatar');
const authorName = document.getElementById('authorName');
const authorHandle = document.getElementById('authorHandle');
const mediaTypeBadge = document.getElementById('mediaTypeBadge');
const previewVideo = document.getElementById('previewVideo');
const previewImage = document.getElementById('previewImage');

// Caption Controls
const captionLiveBanner = document.getElementById('captionLiveBanner');
const toggleCaptionBtn = document.getElementById('toggleCaptionBtn');
const clearCaptionBtn = document.getElementById('clearCaptionBtn');
const captionBtnText = document.getElementById('captionBtnText');
const captionEditorPanel = document.getElementById('captionEditorPanel');
const captionInput = document.getElementById('captionInput');
const charCount = document.getElementById('charCount');

// Hero Action Button
const convertBtn = document.getElementById('convertBtn');
const convertBtnLabel = document.getElementById('convertBtnLabel');

// Progress Bar
const progressContainer = document.getElementById('progressContainer');
const progressText = document.getElementById('progressText');
const progressTimer = document.getElementById('progressTimer');
const progressBar = document.getElementById('progressBar');

// Result Card & Actions
const resultContainer = document.getElementById('resultContainer');
const resultGif = document.getElementById('resultGif');
const gifSizeText = document.getElementById('gifSizeText');
const gifLimitText = document.getElementById('gifLimitText');
const downloadLink = document.getElementById('downloadLink');
const klipyLink = document.getElementById('klipyLink');

// =============================================================================
// ESTADO DA APLICAÇÃO
// =============================================================================

let currentMode = 'discord'; // 'discord' ou 'standard'
let activeMediaList = [];
let selectedMediaIndex = 0;
let currentGifBlob = null;
let isCaptionActive = false;
let timerInterval = null;
let timerCount = 0;

// =============================================================================
// SISTEMA DE STATUS
// =============================================================================

/**
 * Atualiza o badge de status pulsante no cabeçalho.
 * @param {'ready'|'busy'|'error'} state - Estado atual
 * @param {string} text - Texto descritivo
 */
function updateStatusBadge(state, text) {
  if (statusBadge && statusBadgeText) {
    statusBadge.className = `status-badge status-${state}`;
    statusBadgeText.textContent = text;
  }
}

/**
 * Log helper silencioso (sem popups intrusivos na interface).
 * @param {string} message - Mensagem
 * @param {'info'|'success'|'error'|'warning'} [type='info'] - Tipo
 */
function showToast(message, type = 'info') {
  if (type === 'error') {
    console.error(`[Discord GIF Machine] ${message}`);
  } else {
    console.log(`[Discord GIF Machine] [${type.toUpperCase()}] ${message}`);
  }
}

/** Escapa caracteres HTML para segurança */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Formata bytes para string amigável */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** Extrai ID do tweet a partir de links do Twitter/X */
function extractTweetId(url) {
  if (!url) return null;
  const str = url.trim();
  if (/^\d{5,25}$/.test(str)) return str;
  const m =
    str.match(/(?:twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com)\/(?:#!\/)?(?:[a-zA-Z0-9_]+)\/status(?:es)?\/(\d+)/i) ||
    str.match(/(?:twitter\.com|x\.com)\/i\/(?:web\/)?status\/(\d+)/i) ||
    str.match(/\/status\/(\d+)/i);
  return m ? m[1] : null;
}

// =============================================================================
// COMUNICAÇÃO COM O SERVICE WORKER
// =============================================================================

/**
 * Envia mensagem ao Service Worker (background.js).
 * @param {string} action
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
function sendToBackground(action, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('Sem resposta do Service Worker.'));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error || 'Erro no Service Worker.'));
        return;
      }
      resolve(response);
    });
  });
}

// =============================================================================
// HISTÓRICO PERSISTENTE
// =============================================================================

async function saveToHistory(gifData, tweetData) {
  try {
    const result = await chrome.storage.local.get('gif_history');
    const history = result.gif_history || [];

    history.unshift({
      tweetId: tweetData?.id || '',
      author: tweetData?.author?.name || 'Local',
      handle: tweetData?.author?.screen_name || '',
      size: gifData.sizeFormatted,
      timestamp: Date.now()
    });

    if (history.length > 10) history.splice(10);
    await chrome.storage.local.set({ gif_history: history });
  } catch (err) {
    console.warn('[Popup] Erro ao salvar histórico:', err.message);
  }
}

// =============================================================================
// MODO DE CONVERSÃO
// =============================================================================

modeDiscordBtn.addEventListener('click', () => setConversionMode('discord'));
modeStandardBtn.addEventListener('click', () => setConversionMode('standard'));

function setConversionMode(mode) {
  currentMode = mode;

  if (mode === 'discord') {
    modeDiscordBtn.classList.add('active');
    modeDiscordBtn.setAttribute('aria-selected', 'true');
    modeStandardBtn.classList.remove('active');
    modeStandardBtn.setAttribute('aria-selected', 'false');

    activeModeBadge.textContent = 'Discord (≤ 8MB)';
  } else {
    modeStandardBtn.classList.add('active');
    modeStandardBtn.setAttribute('aria-selected', 'true');
    modeDiscordBtn.classList.remove('active');
    modeDiscordBtn.setAttribute('aria-selected', 'false');

    activeModeBadge.textContent = 'Padrão (≤ 20MB)';
  }

  updateHeroButtonLabel();
}

// =============================================================================
// CONTROLE DE CAPTION (MEME GENERATOR)
// =============================================================================

toggleCaptionBtn.addEventListener('click', () => {
  isCaptionActive = !isCaptionActive;
  updateCaptionUI();
  if (isCaptionActive) {
    captionInput.focus();
  }
});

clearCaptionBtn.addEventListener('click', () => {
  captionInput.value = '';
  charCount.textContent = '0/200';
  isCaptionActive = false;
  updateCaptionUI();
  updateLiveCaptionPreview();
  updateHeroButtonLabel();
});

captionInput.addEventListener('input', () => {
  const len = captionInput.value.length;
  charCount.textContent = `${len}/200`;
  updateLiveCaptionPreview();
  updateHeroButtonLabel();
});

function updateCaptionUI() {
  if (isCaptionActive) {
    captionEditorPanel.classList.add('visible');
    clearCaptionBtn.classList.add('visible');
    toggleCaptionBtn.classList.add('active');
    captionBtnText.textContent = 'Ocultar Editor';
    updateLiveCaptionPreview();
  } else {
    captionEditorPanel.classList.remove('visible');
    toggleCaptionBtn.classList.remove('active');
    if (!captionInput.value.trim()) {
      clearCaptionBtn.classList.remove('visible');
      captionLiveBanner.classList.remove('visible');
    }
    captionBtnText.textContent = captionInput.value.trim()
      ? 'Editar Legenda'
      : 'Adicionar Legenda Meme';
  }
  updateHeroButtonLabel();
}

function updateLiveCaptionPreview() {
  const text = captionInput.value.trim();
  if (text) {
    captionLiveBanner.textContent = text;
    captionLiveBanner.classList.add('visible');
  } else {
    captionLiveBanner.classList.remove('visible');
  }
}

/** Atualiza dinamicamente o texto do botão Hero com base no tipo de mídia e legenda */
function updateHeroButtonLabel() {
  const media = activeMediaList[selectedMediaIndex];
  const hasCaption = captionInput.value.trim().length > 0;
  const maxLimitLabel = currentMode === 'discord' ? '8MB' : '20MB';

  if (!media) {
    convertBtnLabel.textContent = `Gerar GIF para Discord`;
    return;
  }

  if (media.type === 'photo') {
    convertBtnLabel.textContent = hasCaption
      ? 'Gerar GIF com Legenda'
      : 'Converter Imagem para GIF Estático';
  } else if (media.type === 'gif') {
    if (media.fileSize && media.fileSize <= (LIMITS[currentMode] || LIMITS.discord) && !hasCaption) {
      convertBtnLabel.textContent = `Baixar GIF Original (≤${maxLimitLabel})`;
    } else {
      convertBtnLabel.textContent = hasCaption
        ? 'Gerar GIF com Legenda'
        : `Otimizar GIF para Discord (≤${maxLimitLabel})`;
    }
  } else {
    convertBtnLabel.textContent = hasCaption
      ? 'Gerar GIF com Legenda'
      : `Gerar GIF para Discord (≤${maxLimitLabel})`;
  }
}

// =============================================================================
// BOTÃO "MAIS OPÇÕES" (ACCORDION / DROPDOWN TOGGLE)
// =============================================================================

let isMoreOptionsOpen = false;

moreOptionsToggleBtn.addEventListener('click', () => {
  toggleMoreOptions();
});

function toggleMoreOptions(forceState) {
  isMoreOptionsOpen = typeof forceState === 'boolean' ? forceState : !isMoreOptionsOpen;

  if (isMoreOptionsOpen) {
    moreOptionsDropdown.classList.add('visible');
    moreOptionsToggleBtn.classList.add('active');
    moreOptionsToggleBtn.setAttribute('aria-expanded', 'true');
    moreOptionsBtnText.textContent = 'Ocultar opções';
    tweetUrlInput.focus();
  } else {
    moreOptionsDropdown.classList.remove('visible');
    moreOptionsToggleBtn.classList.remove('active');
    moreOptionsToggleBtn.setAttribute('aria-expanded', 'false');
    moreOptionsBtnText.textContent = 'Mais opções';
  }
}

// Auto-expande o dropdown se o usuário arrastar um arquivo para a janela da extensão
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
    if (!isMoreOptionsOpen) {
      toggleMoreOptions(true);
    }
  }
});

// =============================================================================
// ENTRADA DE URL & COLAR CLIPBOARD
// =============================================================================

pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) {
      tweetUrlInput.value = text.trim();
      fetchMedia();
    } else {
      showToast('Área de transferência vazia.', 'warning');
    }
  } catch {
    showToast('Cole o link diretamente com Ctrl+V.', 'info');
    tweetUrlInput.focus();
  }
});

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  fetchMedia();
});

// =============================================================================
// ARQUIVO LOCAL & DRAG AND DROP (VÍDEOS, GIFS E IMAGENS)
// =============================================================================

localFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  loadLocalFile(file);
});

['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('video/') || file.type.startsWith('image/')) {
      loadLocalFile(file);
    } else {
      showToast('Formato não suportado. Selecione um vídeo, GIF ou imagem.', 'error');
    }
  }
});

/** Carrega um arquivo local no player de preview */
function loadLocalFile(file) {
  resultContainer.classList.remove('visible');
  tweetMetaBar.classList.add('hidden');

  const blobUrl = URL.createObjectURL(file);
  const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
  const isImage = file.type.startsWith('image/') && !isGif;
  const mediaType = isImage ? 'photo' : (isGif ? 'gif' : 'video');

  activeMediaList = [{
    url: blobUrl,
    isLocal: true,
    fileName: file.name,
    type: mediaType,
    fileSize: file.size,
    isRealGif: isGif,
    blob: file
  }];

  selectedMediaIndex = 0;
  mediaSelector.classList.remove('visible');

  loadSelectedMedia();
  toggleMoreOptions(false);
  updateStatusBadge('ready', 'Mídia Carregada');

  const typeDesc = isImage ? 'Imagem' : (isGif ? 'GIF' : 'Vídeo');
  showToast(`${typeDesc} local carregado: ${file.name} (${formatBytes(file.size)})`, 'success');
}

// =============================================================================
// BUSCA DE MÍDIA DO TWITTER/X (VÍDEOS, GIFS E FOTOS)
// =============================================================================

async function fetchMedia() {
  const input = tweetUrlInput.value.trim();
  const id = extractTweetId(input);

  if (!id) {
    showToast('Insira um link válido do Twitter/X.', 'error');
    updateStatusBadge('error', 'Link Inválido');
    return;
  }

  previewContainer.classList.remove('visible');
  resultContainer.classList.remove('visible');
  mediaSelector.classList.remove('visible');

  updateStatusBadge('busy', 'Buscando Post...');
  showToast('Buscando mídia do post no Twitter/X...', 'info');
  fetchBtn.disabled = true;

  try {
    const response = await sendToBackground('EXTRACT_MEDIA', { tweetUrl: input });
    const data = response.data;

    fetchBtn.disabled = false;

    if (!data || (!data.bestVideoUrl && !data.bestImageUrl && (!data.photos || data.photos.length === 0))) {
      updateStatusBadge('error', 'Sem Mídia');
      showToast('Nenhum vídeo, GIF ou imagem encontrado no post.', 'error');
      return;
    }

    // Exibe autor
    if (data.author && (data.author.name || data.author.screen_name)) {
      authorName.textContent = data.author.name || 'Twitter User';
      authorHandle.textContent = data.author.screen_name ? `@${data.author.screen_name}` : '';
      if (data.author.avatar_url) {
        authorAvatar.src = data.author.avatar_url;
        authorAvatar.style.display = 'block';
      } else {
        authorAvatar.style.display = 'none';
      }
      tweetMetaBar.classList.remove('hidden');
    } else {
      tweetMetaBar.classList.add('hidden');
    }

    // Monta lista de mídias encontradas (vídeos ou fotos)
    activeMediaList = [];

    if (data.bestVideoUrl) {
      const isGif = data.isGif || data.mediaType === 'animated_gif' || data.bestVideoUrl.includes('tweet_video');
      activeMediaList.push({
        url: data.bestVideoUrl,
        type: isGif ? 'gif' : 'video',
        isLocal: false,
        isRealGif: data.bestVideoUrl.endsWith('.gif'),
        tweetData: data
      });

      // Variantes de vídeo se houver
      if (data.variants && data.variants.length > 1) {
        const uniqueUrls = [...new Set(data.variants.map(v => v.url))];
        if (uniqueUrls.length > 1) {
          activeMediaList = uniqueUrls.map(url => ({
            url,
            type: isGif ? 'gif' : 'video',
            isLocal: false,
            tweetData: data
          }));
        }
      }
    } else if (data.photos && data.photos.length > 0) {
      activeMediaList = data.photos.map(url => ({
        url,
        type: 'photo',
        isLocal: false,
        tweetData: data
      }));
    } else if (data.bestImageUrl) {
      activeMediaList = [{
        url: data.bestImageUrl,
        type: 'photo',
        isLocal: false,
        tweetData: data
      }];
    }

    selectedMediaIndex = 0;

    // Seletor de múltiplas mídias
    if (activeMediaList.length > 1) {
      mediaSelector.innerHTML = activeMediaList.map((m, idx) => {
        const label = m.type === 'photo' ? `Foto ${idx + 1}` : `Vídeo ${idx + 1}`;
        const chipClass = idx === 0 ? 'media-selector-chip active' : 'media-selector-chip';
        return `<button type="button" class="${chipClass}" data-index="${idx}">${label}</button>`;
      }).join('');
      mediaSelector.classList.add('visible');

      mediaSelector.querySelectorAll('button').forEach(chip => {
        chip.addEventListener('click', () => {
          selectedMediaIndex = parseInt(chip.dataset.index);
          mediaSelector.querySelectorAll('button').forEach((b, i) => {
            b.className = i === selectedMediaIndex ? 'media-selector-chip active' : 'media-selector-chip';
          });
          loadSelectedMedia();
        });
      });
    }

    loadSelectedMedia();
    toggleMoreOptions(false);
    updateStatusBadge('ready', 'Mídia Detectada');
    showToast('Mídia encontrada com sucesso!', 'success');

  } catch (err) {
    fetchBtn.disabled = false;
    updateStatusBadge('error', 'Erro na Busca');
    showToast(err.message || 'Erro ao conectar ao Twitter/X.', 'error');
  }
}

/** Carrega a mídia atual no preview (Vídeo ou Imagem) */
function loadSelectedMedia() {
  const media = activeMediaList[selectedMediaIndex];
  if (!media) return;

  if (media.type === 'photo') {
    mediaTypeBadge.textContent = 'Imagem';
    previewVideo.classList.add('hidden');
    previewVideo.pause();

    previewImage.src = media.url;
    previewImage.classList.remove('hidden');
  } else if (media.type === 'gif') {
    mediaTypeBadge.textContent = 'GIF';
    if (media.isRealGif) {
      previewVideo.classList.add('hidden');
      previewVideo.pause();
      previewImage.src = media.url;
      previewImage.classList.remove('hidden');
    } else {
      previewImage.classList.add('hidden');
      previewVideo.src = media.url;
      previewVideo.classList.remove('hidden');
      previewVideo.load();
      previewVideo.play().catch(() => {});
    }
  } else {
    mediaTypeBadge.textContent = 'Vídeo';
    previewImage.classList.add('hidden');
    previewVideo.src = media.url;
    previewVideo.classList.remove('hidden');
    previewVideo.load();
    previewVideo.play().catch(() => {});
  }

  previewContainer.classList.add('visible');
  resultContainer.classList.remove('visible');
  updateLiveCaptionPreview();
  updateHeroButtonLabel();
}

// =============================================================================
// BYPASS CORS DE MÍDIA REMOTA
// =============================================================================

async function getCORSMediaBlobUrl(mediaUrl) {
  if (mediaUrl.startsWith('blob:')) return mediaUrl;

  try {
    const res = await fetch(mediaUrl, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }
  } catch {
    // Fallback
  }

  try {
    const response = await sendToBackground('FETCH_MEDIA', { mediaUrl });
    return response.dataUri;
  } catch (err) {
    console.warn('[Popup] Fallback CORS falhou:', err.message);
    return mediaUrl;
  }
}

// =============================================================================
// CÁLCULO DE LAYOUT DA LEGENDA (CANVAS COM GARANTIA DE 100% VISIBILIDADE)
// =============================================================================

/**
 * Computa o layout tipográfico da legenda garantindo que 100% dos caracteres
 * caibam perfeitamente dentro dos limites da imagem/GIF (sem corte nas bordas).
 *
 * @param {string} text - Texto da legenda
 * @param {number} width - Largura em pixels do canvas
 * @returns {Object} Layout com linhas, fontSize, lineHeight, padding e captionHeight
 */
function computeCaptionLayout(text, width) {
  if (!text || !text.trim()) {
    return { lines: [], fontSize: 0, lineHeight: 0, paddingY: 0, captionHeight: 0 };
  }

  const cleanText = text.trim();
  // Margem segura lateral de 5% em cada lado (90% de largura útil para o texto)
  const maxTextWidth = Math.floor(width * 0.90);

  // Escala inicial de fonte baseada na largura e quantidade de texto
  let fontSize = Math.max(16, Math.round(width * 0.082));
  if (cleanText.length > 70) fontSize = Math.max(14, Math.round(fontSize * 0.88));
  if (cleanText.length > 130) fontSize = Math.max(13, Math.round(fontSize * 0.80));

  const measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');

  function calculateLines(size) {
    ctx.font = `bold ${size}px "Futura Condensed Extra Bold", "Futura", -apple-system, sans-serif`;
    const paragraphs = cleanText.split('\n');
    const computedLines = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let currentLine = '';

      for (const word of words) {
        // Se uma única palavra/link for mais larga que a tela, divide caractere por caractere
        if (ctx.measureText(word).width > maxTextWidth) {
          if (currentLine) {
            computedLines.push(currentLine);
            currentLine = '';
          }
          let chunk = '';
          for (const char of word) {
            if (ctx.measureText(chunk + char).width <= maxTextWidth) {
              chunk += char;
            } else {
              if (chunk) computedLines.push(chunk);
              chunk = char;
            }
          }
          if (chunk) currentLine = chunk;
          continue;
        }

        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width <= maxTextWidth) {
          currentLine = testLine;
        } else {
          if (currentLine) computedLines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) computedLines.push(currentLine);
    }
    return computedLines;
  }

  let lines = calculateLines(fontSize);

  // Se o número de linhas ficou muito grande (> 4), reduz levemente a fonte para manter equilíbrio
  if (lines.length > 4 && fontSize > 14) {
    fontSize = Math.max(13, Math.round(fontSize * 0.85));
    lines = calculateLines(fontSize);
  }

  const lineHeight = Math.round(fontSize * 1.20);
  const paddingY = Math.round(fontSize * 0.55);
  const captionHeight = (lines.length * lineHeight) + (paddingY * 2);

  return { lines, fontSize, lineHeight, paddingY, captionHeight };
}

// =============================================================================
// CONVERSÃO & PROCESSAMENTO INTELIGENTE DE GIFS E IMAGENS
// =============================================================================

convertBtn.addEventListener('click', startConversion);

/**
 * Pipeline principal de geração / otimização de GIF:
 *   - Imagens -> converte para GIF estático (com ou sem legenda)
 *   - GIFs <= 8MB sem legenda -> libera direto sem recompressão
 *   - GIFs > 8MB ou Vídeos -> comprime via gifshot com limite garantido
 */
async function startConversion() {
  const media = activeMediaList[selectedMediaIndex];
  if (!media || !media.url) {
    showToast('Nenhuma mídia carregada para conversão.', 'warning');
    return;
  }

  const maxAllowedBytes = LIMITS[currentMode] || LIMITS.discord;
  const maxLimitLabel = currentMode === 'discord' ? '8.0 MB' : '20.0 MB';

  const captionText = captionInput.value.trim();
  const hasCaption = captionText.length > 0;

  // CASO 1: É um arquivo GIF real E já é <= 8MB E NÃO tem legenda
  // Não precisa de conversão pesada! Entrega o GIF original diretamente.
  if (media.isRealGif && !hasCaption) {
    try {
      let gifBlob = media.blob;
      if (!gifBlob) {
        const res = await fetch(media.url);
        gifBlob = await res.blob();
      }

      if (gifBlob.size <= maxAllowedBytes) {
        currentGifBlob = gifBlob;
        displayGifResult(gifBlob, maxLimitLabel);
        updateStatusBadge('ready', 'GIF Pronto');
        showToast(`GIF pronto para uso (${formatBytes(gifBlob.size)} ≤ ${maxLimitLabel})!`, 'success');
        return;
      }
    } catch {
      // Se falhar ao ler blob, segue para o pipeline padrão
    }
  }

  if (!window.gifshot) {
    showToast('Aguarde o carregamento do motor gifshot e tente novamente.', 'warning');
    return;
  }

  resultContainer.classList.remove('visible');
  progressContainer.classList.add('visible');
  convertBtn.disabled = true;
  updateStatusBadge('busy', 'Processando...');

  timerCount = 0;
  progressTimer.textContent = '0s';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerCount++;
    progressTimer.textContent = `${timerCount}s`;
  }, 1000);

  try {
    progressText.textContent = 'Carregando mídia...';
    progressBar.style.width = '15%';

    if (document.fonts) {
      await document.fonts.ready;
    }

    const cleanBlobUrl = await getCORSMediaBlobUrl(media.url);

    // =========================================================================
    // CASO 2: CONVERSÃO DE IMAGEM ESTÁTICA PARA GIF
    // =========================================================================
    if (media.type === 'photo') {
      progressText.textContent = 'Renderizando imagem em GIF...';
      progressBar.style.width = '40%';

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = cleanBlobUrl;

      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Falha ao carregar imagem para conversão.'));
      });

      const naturalW = img.naturalWidth || img.width || 600;
      const naturalH = img.naturalHeight || img.height || 400;
      const targetWidth = Math.min(naturalW, currentMode === 'discord' ? 600 : 800);
      const imgRatio = naturalH / naturalW;
      const renderImgHeight = Math.round(targetWidth * imgRatio);

      const frameCanvas = document.createElement('canvas');
      const ctx = frameCanvas.getContext('2d');

      let totalHeight = renderImgHeight;
      let captionLayout = null;

      if (hasCaption) {
        captionLayout = computeCaptionLayout(captionText, targetWidth);
        totalHeight = renderImgHeight + captionLayout.captionHeight;
      }

      frameCanvas.width = targetWidth;
      frameCanvas.height = totalHeight;

      if (hasCaption) {
        // Banner branco + Legenda Futura Bold
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetWidth, captionLayout.captionHeight);

        ctx.fillStyle = '#000000';
        ctx.font = `bold ${captionLayout.fontSize}px "Futura Condensed Extra Bold", "Futura", -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const startY = captionLayout.paddingY + (captionLayout.lineHeight / 2);
        captionLayout.lines.forEach((line, i) => {
          ctx.fillText(line, targetWidth / 2, startY + (i * captionLayout.lineHeight));
        });

        // Desenha imagem abaixo da legenda
        ctx.drawImage(img, 0, captionLayout.captionHeight, targetWidth, renderImgHeight);
      } else {
        // Apenas imagem direta
        ctx.drawImage(img, 0, 0, targetWidth, renderImgHeight);
      }

      progressBar.style.width = '75%';
      progressText.textContent = 'Codificando arquivo GIF...';

      const finalObj = await new Promise((resolve, reject) => {
        gifshot.createGIF({
          images: [frameCanvas.toDataURL('image/png')],
          gifWidth: targetWidth,
          gifHeight: totalHeight,
          numFrames: 1,
          interval: 1,
          progressCallback: (p) => {
            progressBar.style.width = `${75 + Math.round(p * 20)}%`;
          }
        }, (obj) => {
          if (obj.error) return reject(new Error(obj.errorMsg || 'Erro ao gerar GIF estático.'));
          resolve(obj);
        });
      });

      const base64 = finalObj.image.split(',')[1];
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      const finalBlob = new Blob([new Uint8Array(byteNums)], { type: 'image/gif' });

      finishConversionSuccess(finalBlob, maxLimitLabel, media);
      return;
    }

    // =========================================================================
    // CASO 3: CONVERSÃO / COMPRESSÃO DE VÍDEO OU GIF ANIMADO
    // =========================================================================
    const duration = previewVideo.duration && isFinite(previewVideo.duration) ? previewVideo.duration : 4;

    let targetDuration, targetWidth, targetFps;
    if (currentMode === 'discord') {
      targetDuration = Math.min(duration, 6);
      targetWidth = 480;
      targetFps = 15;
    } else {
      targetDuration = Math.min(duration, 9);
      targetWidth = 600;
      targetFps = 20;
    }

    let pass = 0;
    let finalBlob = null;
    let finalObj = null;

    // Loop adaptativo de até 3 passes para respeitar o limite de 8MB / 20MB
    while (pass < 3) {
      pass++;
      progressText.textContent = `Renderizando GIF (${targetWidth}px, ${targetFps}fps)...`;
      progressBar.style.width = `${20 + pass * 20}%`;

      const interval = 1 / targetFps;
      const numFrames = Math.max(6, Math.min(
        Math.round(targetDuration * targetFps),
        currentMode === 'discord' ? 70 : 110
      ));

      if (!hasCaption) {
        finalObj = await new Promise((resolve, reject) => {
          gifshot.createGIF({
            video: [cleanBlobUrl],
            gifWidth: targetWidth,
            gifHeight: Math.round(
              targetWidth * (previewVideo.videoHeight / (previewVideo.videoWidth || 1)) || targetWidth * 0.5625
            ),
            interval: interval,
            numFrames: numFrames,
            sampleInterval: currentMode === 'discord' ? 10 : 8,
            numWorkers: navigator.hardwareConcurrency
              ? Math.min(navigator.hardwareConcurrency, 4)
              : 2,
            progressCallback: (p) => {
              progressBar.style.width = `${20 + Math.round(p * 70)}%`;
            }
          }, (obj) => {
            if (obj.error) return reject(new Error(obj.errorMsg || 'Erro ao processar frames do GIF.'));
            resolve(obj);
          });
        });
      } else {
        progressText.textContent = `Desenhando legenda meme no GIF (Passe ${pass})...`;

        const captionLayout = computeCaptionLayout(captionText, targetWidth);
        const videoRatio = previewVideo.videoHeight / (previewVideo.videoWidth || 1) || 0.5625;
        const videoRenderHeight = Math.round(targetWidth * videoRatio);
        const totalCanvasHeight = videoRenderHeight + captionLayout.captionHeight;

        const offscreenVideo = document.createElement('video');
        offscreenVideo.src = cleanBlobUrl;
        offscreenVideo.muted = true;
        offscreenVideo.playsInline = true;
        offscreenVideo.crossOrigin = 'anonymous';

        await new Promise((res, rej) => {
          offscreenVideo.onloadeddata = res;
          offscreenVideo.onerror = rej;
          offscreenVideo.load();
        });

        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = targetWidth;
        frameCanvas.height = totalCanvasHeight;
        const ctx = frameCanvas.getContext('2d');

        const capturedFrames = [];
        const timeStep = targetDuration / numFrames;

        for (let f = 0; f < numFrames; f++) {
          const seekTime = f * timeStep;
          offscreenVideo.currentTime = seekTime;

          await new Promise(r => {
            const onSeek = () => {
              offscreenVideo.removeEventListener('seeked', onSeek);
              r();
            };
            offscreenVideo.addEventListener('seeked', onSeek);
          });

          // Banner de legenda
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetWidth, captionLayout.captionHeight);

          ctx.fillStyle = '#000000';
          ctx.font = `bold ${captionLayout.fontSize}px "Futura Condensed Extra Bold", "Futura", -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const startY = captionLayout.paddingY + (captionLayout.lineHeight / 2);
          captionLayout.lines.forEach((line, i) => {
            ctx.fillText(line, targetWidth / 2, startY + (i * captionLayout.lineHeight));
          });

          // Frame do vídeo
          ctx.drawImage(offscreenVideo, 0, captionLayout.captionHeight, targetWidth, videoRenderHeight);

          capturedFrames.push(frameCanvas.toDataURL('image/png'));
          progressBar.style.width = `${15 + Math.round((f / numFrames) * 50)}%`;
        }

        // Codifica frames
        progressText.textContent = `Otimizando paleta e tamanho (≤ ${maxLimitLabel})...`;
        finalObj = await new Promise((resolve, reject) => {
          gifshot.createGIF({
            images: capturedFrames,
            gifWidth: targetWidth,
            gifHeight: totalCanvasHeight,
            interval: interval,
            numFrames: numFrames,
            sampleInterval: currentMode === 'discord' ? 10 : 8,
            numWorkers: navigator.hardwareConcurrency
              ? Math.min(navigator.hardwareConcurrency, 4)
              : 2,
            progressCallback: (p) => {
              progressBar.style.width = `${65 + Math.round(p * 30)}%`;
            }
          }, (obj) => {
            if (obj.error) return reject(new Error(obj.errorMsg || 'Erro ao codificar GIF.'));
            resolve(obj);
          });
        });
      }

      const base64 = finalObj.image.split(',')[1];
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      finalBlob = new Blob([new Uint8Array(byteNums)], { type: 'image/gif' });

      // Se respeitou o limite de tamanho, finaliza
      if (finalBlob.size <= maxAllowedBytes) {
        break;
      }

      // Se excedeu o limite (>8MB no Discord), escala para baixo e reprocessa
      progressText.textContent = `Ajustando tamanho (${formatBytes(finalBlob.size)} > ${maxLimitLabel})...`;
      const scale = Math.sqrt(maxAllowedBytes / finalBlob.size) * 0.88;
      targetWidth = Math.max(240, Math.floor((targetWidth * scale) / 2) * 2);
      targetFps = Math.max(10, Math.round(targetFps * scale));
      targetDuration = Math.min(targetDuration, currentMode === 'discord' ? 5 : 7);
    }

    finishConversionSuccess(finalBlob, maxLimitLabel, media);

  } catch (err) {
    clearInterval(timerInterval);
    progressContainer.classList.remove('visible');
    convertBtn.disabled = false;
    updateStatusBadge('error', 'Erro na Conversão');
    showToast(err.message || 'Erro durante a conversão do GIF.', 'error');
  }
}

/** Finaliza com sucesso a conversão e exibe o resultado */
function finishConversionSuccess(blob, maxLimitLabel, media) {
  clearInterval(timerInterval);
  progressBar.style.width = '100%';
  setTimeout(() => {
    progressContainer.classList.remove('visible');
    convertBtn.disabled = false;
  }, 300);

  currentGifBlob = blob;
  displayGifResult(blob, maxLimitLabel);
  updateStatusBadge('ready', 'GIF Concluído');
  showToast(`GIF gerado com sucesso! (${formatBytes(blob.size)})`, 'success');

  const tweetData = media.tweetData || null;
  saveToHistory({ sizeFormatted: formatBytes(blob.size) }, tweetData);
}

// =============================================================================
// EXIBIÇÃO DO RESULTADO
// =============================================================================

function displayGifResult(blob, maxLimitLabel) {
  const url = URL.createObjectURL(blob);
  resultGif.src = url;
  gifSizeText.textContent = formatBytes(blob.size);
  gifLimitText.textContent = `(≤ ${maxLimitLabel})`;

  downloadLink.href = url;
  downloadLink.download = `discord_gif_${Date.now()}.gif`;

  resultContainer.classList.add('visible');
  resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// =============================================================================
// INICIALIZAÇÃO & AUTO-DETECÇÃO NA ABA ATIVA
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Discord GIF Machine] Popup inicializado.');
  updateStatusBadge('ready', 'Pronto');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url) {
      const tweetId = extractTweetId(tab.url);

      if (tweetId) {
        tweetUrlInput.value = tab.url;
        showToast('Link do Twitter/X detectado na aba ativa!', 'info');
        fetchMedia();
      }
    }
  } catch (err) {
    console.warn('[Popup] Não foi possível ler a URL da aba ativa:', err.message);
  }
});

