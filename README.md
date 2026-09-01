# <img src="extension/assets/icon-48.png" width="28" height="28" valign="middle" alt="LeaFFMPEG"> LeaFFMPEG

Extensão de navegador pra converter vídeos, GIFs e imagens do Twitter, Discord ou arquivos locais em GIFs perfeitamente otimizados para o **limite de 8MB do Discord**, e com suporte a **Legendas (Captions)** no estilo popular de memes (esmbot).

(eu sei que o discord aumentou o limite de upload mas eu fiz essa extensão antes desse update)

---

## Como Instalar a Extensão

1. Abra seu navegador baseado em Chromium (**Google Chrome**, **Brave**, **Microsoft Edge**, **Opera**, etc.).
2. Acesse a página de extensões:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`
3. Ative a chave **Modo do desenvolvedor** (Developer mode) no canto superior direito.
4. Clique no botão **Carregar sem compactação** (Load unpacked).
5. Selecione a pasta **`extension/`** deste repositório.
6. Pronto! O ícone do **LeaFFMPEG** estará disponível na barra de ferramentas de extensões.

---

## Features

- **Suporte a Twitter/X e Discord**: Cole links de tweets, links diretos de anexos do Discord (`cdn.discordapp.com`) ou links de mensagens do Discord.
- **Detecção Automática**: Ao abrir a extensão enquanto estiver no Twitter ou Discord Web, a mídia é detectada e carregada automaticamente.
- **Entrada Manual & Drag and Drop**: Cole URLs ou arraste arquivos de vídeo (`.mp4`, `.webm`) e imagens (`.gif`, `.png`, `.jpg`, `.webp`).
- **Otimização Inteligente para Discord**: Garante que o GIF gerado respeite estritamente o limite de **8.0 MB** para envio no Discord sem Nitro.
- **Modo Padrão (≤ 20MB)**: Para quem deseja maior resolução/taxa de quadros compatível com limites maiores.
- **Legendas Meme em Tempo Real**: Adicione barras de legenda superior clássicas com a fonte **Futura Condensed Extra Bold**.
- **Modo "Destruir Qualidade" (Meme Crunch & Bitcrush)**: Sliders configuráveis para arrancar a qualidade da imagem/vídeo em níveis astronômicos — compressão JPEG estilo zap, pixelização 144p, bitcrush de cores e deep fried para criar memes com a qualidade toda estragada.
- **Processamento 100% Client-Side**: As conversões rodam diretamente no navegador usando o motor `gifshot`, sem depender de servidores externos.

---
