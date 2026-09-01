# 👾 Discord GIF Machine (≤ 8MB) — Extensão de Navegador

Extensão de navegador (Manifest V3) para converter vídeos, GIFs e imagens do Twitter/X ou arquivos locais em GIFs perfeitamente otimizados para o **limite de 8MB do Discord**, com suporte a **Legendas (Captions)** no estilo clássico de memes do Discord (esmbot / Tenor).

---

## ⚡ Como Instalar a Extensão

1. Abra seu navegador baseado em Chromium (**Google Chrome**, **Brave**, **Microsoft Edge**, **Opera**, etc.).
2. Acesse a página de extensões:
   - **Chrome**: `chrome://extensions`
   - **Brave**: `brave://extensions`
   - **Edge**: `edge://extensions`
3. Ative a chave **Modo do desenvolvedor** (Developer mode) no canto superior direito.
4. Clique no botão **Carregar sem compactação** (Load unpacked).
5. Selecione a pasta **`extension/`** deste repositório.
6. Pronto! O ícone do **Discord GIF Machine** estará disponível na barra de ferramentas de extensões.

---

## 🚀 Funcionalidades

- **Detecção Automática**: Ao abrir a extensão enquanto estiver em um post do Twitter/X, a mídia é detectada e carregada automaticamente.
- **Entrada Manual & Drag and Drop**: Cole URLs de posts ou arraste arquivos de vídeo (`.mp4`, `.webm`) e imagens (`.gif`, `.png`, `.jpg`, `.webp`).
- **Otimização Inteligente para Discord**: Garante que o GIF gerado respeite estritamente o limite de **8.0 MB** para envio no Discord sem Nitro.
- **Modo Padrão (≤ 20MB)**: Para quem deseja maior resolução/taxa de quadros compatível com limites maiores.
- **Legendas Meme em Tempo Real**: Adicione barras de legenda superior clássicas com a fonte **Futura Condensed Extra Bold**.
- **Processamento 100% Client-Side**: As conversões rodam diretamente no navegador usando o motor `gifshot`, sem depender de servidores externos.

---

## 📁 Estrutura de Arquivos

```
GIF Downloader/
├── .gitignore
├── README.md
└── extension/
    ├── manifest.json              # Configuração Manifest V3
    ├── background.js              # Service Worker (Bypass CORS & extração de mídias)
    ├── assets/                    # Ícones da extensão (16x16, 48x48, 128x128)
    ├── fonts/
    │   └── futura-condensed.otf   # Fonte Futura Condensed Extra Bold
    ├── lib/
    │   └── gifshot.min.js         # Motor de geração de GIF client-side
    └── popup/
        ├── popup.html             # Interface do popup da extensão
        ├── popup.css              # Estilos e temas modernos
        └── popup.js               # Controlador da interface e conversão
```

