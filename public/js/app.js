// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  loadHistory();
});

// DOM Elements
const tweetUrlInput = document.getElementById('tweetUrlInput');
const clearInputBtn = document.getElementById('clearInputBtn');
const pasteBtn = document.getElementById('pasteBtn');
const fetchBtn = document.getElementById('fetchBtn');

const errorAlert = document.getElementById('errorAlert');
const errorMessage = document.getElementById('errorMessage');
const closeErrorBtn = document.getElementById('closeErrorBtn');

const progressBox = document.getElementById('progressBox');
const progressStatusTitle = document.getElementById('progressStatusTitle');
const progressStatusDesc = document.getElementById('progressStatusDesc');
const progressBar = document.getElementById('progressBar');
const progressTimer = document.getElementById('progressTimer');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');

const previewSection = document.getElementById('previewSection');
const authorAvatar = document.getElementById('authorAvatar');
const authorName = document.getElementById('authorName');
const authorHandle = document.getElementById('authorHandle');
const tweetText = document.getElementById('tweetText');
const previewVideo = document.getElementById('previewVideo');
const mediaTypeBadge = document.getElementById('mediaTypeBadge');
const convertNowBtn = document.getElementById('convertNowBtn');

const customControls = document.getElementById('customControls');
const customFpsInput = document.getElementById('customFpsInput');
const customWidthInput = document.getElementById('customWidthInput');
const customDurationInput = document.getElementById('customDurationInput');

const resultSection = document.getElementById('resultSection');
const resultGifImage = document.getElementById('resultGifImage');
const resultFileSize = document.getElementById('resultFileSize');
const resultSizeBar = document.getElementById('resultSizeBar');
const resultWidth = document.getElementById('resultWidth');
const resultFps = document.getElementById('resultFps');
const resultDuration = document.getElementById('resultDuration');
const resultPassesBadge = document.getElementById('resultPassesBadge');
const directDownloadBtn = document.getElementById('directDownloadBtn');
const copyGifBtn = document.getElementById('copyGifBtn');
const copyGifText = document.getElementById('copyGifText');
const resetBtn = document.getElementById('resetBtn');

const historyToggleBtn = document.getElementById('historyToggleBtn');
const historyModal = document.getElementById('historyModal');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// State
let currentTweetData = null;
let selectedPreset = 'auto';
let progressInterval = null;
let timerSeconds = 0;

// Input Events
tweetUrlInput.addEventListener('input', () => {
  if (tweetUrlInput.value.trim().length > 0) {
    clearInputBtn.classList.remove('hidden');
  } else {
    clearInputBtn.classList.add('hidden');
  }
});

clearInputBtn.addEventListener('click', () => {
  tweetUrlInput.value = '';
  clearInputBtn.classList.add('hidden');
  tweetUrlInput.focus();
});

pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      tweetUrlInput.value = text.trim();
      clearInputBtn.classList.remove('hidden');
      fetchTweetInfo();
    }
  } catch (err) {
    showError('Permissão para acessar a área de transferência negada. Cole manualmente com Ctrl+V.');
  }
});

tweetUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    fetchTweetInfo();
  }
});

fetchBtn.addEventListener('click', fetchTweetInfo);

closeErrorBtn.addEventListener('click', () => {
  errorAlert.classList.add('hidden');
});

// Preset Buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPreset = btn.dataset.preset;

    if (selectedPreset === 'custom') {
      customControls.classList.remove('hidden');
    } else {
      customControls.classList.add('hidden');
    }
  });
});

convertNowBtn.addEventListener('click', startConversion);
resetBtn.addEventListener('click', resetAll);

// History Modal
historyToggleBtn.addEventListener('click', () => {
  renderHistory();
  historyModal.classList.remove('hidden');
});

closeHistoryBtn.addEventListener('click', () => {
  historyModal.classList.add('hidden');
});

historyModal.addEventListener('click', (e) => {
  if (e.target === historyModal) {
    historyModal.classList.add('hidden');
  }
});

clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem('gif_downloader_history');
  renderHistory();
});

// Copy GIF to Clipboard
copyGifBtn.addEventListener('click', async () => {
  if (!resultGifImage.src) return;

  try {
    copyGifText.textContent = 'Copiando...';
    const response = await fetch(resultGifImage.src);
    const blob = await response.blob();

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        copyGifText.textContent = 'Copiado!';
      } catch (clipErr) {
        // Fallback: Copy link
        await navigator.clipboard.writeText(resultGifImage.src);
        copyGifText.textContent = 'Link Copiado!';
      }
    } else {
      await navigator.clipboard.writeText(resultGifImage.src);
      copyGifText.textContent = 'Link Copiado!';
    }

    setTimeout(() => {
      copyGifText.textContent = 'Copiar GIF';
    }, 2500);
  } catch (err) {
    copyGifText.textContent = 'Erro ao copiar';
    setTimeout(() => {
      copyGifText.textContent = 'Copiar GIF';
    }, 2000);
  }
});

// Functions
function showError(msg) {
  errorMessage.textContent = msg;
  errorAlert.classList.remove('hidden');
  lucide.createIcons();
}

function hideError() {
  errorAlert.classList.add('hidden');
}

function startTimer() {
  timerSeconds = 0;
  progressTimer.textContent = '00:00';
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    timerSeconds++;
    const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const s = String(timerSeconds % 60).padStart(2, '0');
    progressTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(progressInterval);
}

function setStep(stepNum) {
  [step1, step2, step3].forEach((el, idx) => {
    el.classList.remove('active', 'completed');
    if (idx + 1 < stepNum) {
      el.classList.add('completed');
    } else if (idx + 1 === stepNum) {
      el.classList.add('active');
    }
  });
}

function resetAll() {
  hideError();
  progressBox.classList.add('hidden');
  previewSection.classList.add('hidden');
  resultSection.classList.add('hidden');
  currentTweetData = null;
  tweetUrlInput.value = '';
  clearInputBtn.classList.add('hidden');
  stopTimer();
}

/**
 * Step 1: Fetch Tweet Metadata
 */
async function fetchTweetInfo() {
  const url = tweetUrlInput.value.trim();
  if (!url) {
    showError('Por favor, cole um link válido do Twitter ou X.');
    return;
  }

  hideError();
  previewSection.classList.add('hidden');
  resultSection.classList.add('hidden');
  progressBox.classList.remove('hidden');

  progressStatusTitle.textContent = 'Extraindo mídia do Twitter/X...';
  progressStatusDesc.textContent = 'Consultando informações do tweet e obtendo fluxo de vídeo';
  progressBar.style.width = '30%';
  setStep(1);
  startTimer();

  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Não foi possível extrair a mídia do tweet.');
    }

    currentTweetData = data.data;
    displayTweetPreview(currentTweetData);

    progressBox.classList.add('hidden');
    stopTimer();

    // If it's already an animated_gif, auto-scroll to preview and set suggested settings
    if (currentTweetData.isGif) {
      mediaTypeBadge.textContent = 'GIF Nativo';
      mediaTypeBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
    } else {
      mediaTypeBadge.textContent = 'Vídeo MP4';
      mediaTypeBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-twitter/20 text-brand-twitter border border-brand-twitter/30';
    }
  } catch (err) {
    progressBox.classList.add('hidden');
    stopTimer();
    showError(err.message);
  }
}

/**
 * Display Tweet details & video player
 */
function displayTweetPreview(tweet) {
  authorName.textContent = tweet.author?.name || 'Usuário do X';
  authorHandle.textContent = tweet.author?.screen_name ? `@${tweet.author.screen_name}` : '';
  authorAvatar.src = tweet.author?.avatar_url || 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png';
  tweetText.textContent = tweet.text || '';

  if (tweet.bestVideoUrl) {
    previewVideo.src = tweet.bestVideoUrl;
    previewVideo.load();
    previewVideo.play().catch(() => {});
  }

  // Pre-fill custom duration if known
  if (tweet.duration && tweet.duration > 0) {
    customDurationInput.value = Math.min(Math.round(tweet.duration), 15);
  }

  previewSection.classList.remove('hidden');
  lucide.createIcons();

  previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Step 2: Convert Video to GIF with 8MB constraint
 */
async function startConversion() {
  if (!currentTweetData || !currentTweetData.bestVideoUrl) {
    showError('Nenhuma mídia carregada para conversão.');
    return;
  }

  hideError();
  progressBox.classList.remove('hidden');
  resultSection.classList.add('hidden');

  progressStatusTitle.textContent = 'Gerando GIF com FFmpeg...';
  progressStatusDesc.textContent = 'Calculando paleta de 256 cores e otimizando para ≤ 8MB';
  progressBar.style.width = '65%';
  setStep(2);
  startTimer();

  const payload = {
    url: currentTweetData.url,
    videoUrl: currentTweetData.bestVideoUrl,
    tweetId: currentTweetData.id,
    quality: selectedPreset
  };

  if (selectedPreset === 'custom') {
    payload.customFps = customFpsInput.value;
    payload.customWidth = customWidthInput.value;
    payload.duration = customDurationInput.value;
  }

  try {
    // Switch to step 3 after a brief moment
    setTimeout(() => {
      if (!progressBox.classList.contains('hidden')) {
        progressStatusTitle.textContent = 'Garantindo limite de 8MB...';
        progressStatusDesc.textContent = 'Validando tamanho do arquivo e aplicando compressão adaptativa';
        progressBar.style.width = '85%';
        setStep(3);
      }
    }, 1800);

    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Falha ao converter o GIF.');
    }

    progressBar.style.width = '100%';
    progressBox.classList.add('hidden');
    stopTimer();

    displayResult(data);
    saveToHistory(data, currentTweetData);
  } catch (err) {
    progressBox.classList.add('hidden');
    stopTimer();
    showError(err.message);
  }
}

/**
 * Display converted GIF result
 */
function displayResult(result) {
  resultGifImage.src = result.previewUrl;
  resultFileSize.textContent = result.fileSizeFormatted;
  
  // Calculate percentage of 8MB (8,388,608 bytes)
  const maxBytes = 8 * 1024 * 1024;
  const pct = Math.min(Math.round((result.fileSize / maxBytes) * 100), 100);
  resultSizeBar.style.width = `${pct}%`;

  if (pct > 90) {
    resultSizeBar.className = 'bg-gradient-to-r from-amber-500 to-emerald-400 h-full rounded-full transition-all duration-500';
  } else {
    resultSizeBar.className = 'bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500';
  }

  resultWidth.textContent = `${result.width}px`;
  resultFps.textContent = `${result.fps} FPS`;
  resultDuration.textContent = `${Number(result.duration).toFixed(1)}s`;
  resultPassesBadge.textContent = `${result.passes} ${result.passes === 1 ? 'Passe' : 'Passes'}`;

  directDownloadBtn.href = result.downloadUrl;
  directDownloadBtn.setAttribute('download', result.fileName);

  resultSection.classList.remove('hidden');
  lucide.createIcons();

  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * History Management (LocalStorage)
 */
function saveToHistory(result, tweet) {
  try {
    const history = JSON.parse(localStorage.getItem('gif_downloader_history') || '[]');
    const item = {
      id: result.fileId,
      tweetId: tweet.id,
      author: tweet.author?.name || 'Twitter',
      handle: tweet.author?.screen_name || '',
      size: result.fileSizeFormatted,
      previewUrl: result.previewUrl,
      downloadUrl: result.downloadUrl,
      fileName: result.fileName,
      timestamp: Date.now()
    };
    
    // Unshift and keep last 10
    history.unshift(item);
    if (history.length > 10) history.pop();
    localStorage.setItem('gif_downloader_history', JSON.stringify(history));
  } catch (e) {}
}

function loadHistory() {
  // Just prepare
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('gif_downloader_history') || '[]');
  
  if (history.length === 0) {
    historyList.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-sm">
        Nenhum GIF convertido recentemente.
      </div>
    `;
    return;
  }

  historyList.innerHTML = history.map(item => `
    <div class="flex items-center justify-between p-3 bg-slate-900/80 rounded-xl border border-slate-800 gap-3">
      <img src="${item.previewUrl}" alt="GIF" class="w-12 h-12 rounded-lg object-cover bg-black border border-slate-700 shrink-0">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-white truncate">${item.author} <span class="text-xs text-slate-500 font-normal">@${item.handle}</span></div>
        <div class="text-xs text-emerald-400 font-mono">${item.size}</div>
      </div>
      <a href="${item.downloadUrl}" download="${item.fileName}" class="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg border border-emerald-500/30 transition flex items-center gap-1">
        <i data-lucide="download" class="w-3.5 h-3.5"></i> Baixar
      </a>
    </div>
  `).join('');

  lucide.createIcons();
}
