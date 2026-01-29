# PWA GitHub Pages (AudioWorklet ultra low-latency)

- URL: https://sicho95.github.io/Sicho_Radio/public/
- Backend (Koyeb): https://mobile-avivah-sicho-96db3843.koyeb.app
- Audio: pcm_s16le/16000Hz/mono
- Capture: AudioWorklet (fallback ScriptProcessor)

Corrections:
- AudioWorklet pour latence minimale
- Bruit blanc corrigé (division Int16 / 0x8000 au lieu de 32768)
- Sélection texte bouton désactivée (touch-action: none + selectstart)
