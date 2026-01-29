// GitHub Pages => chemins relatifs + backend externe (Koyeb)
// V3: AudioWorklet Capture + Playback (Jitter Buffer)

const BACKEND = "https://mobile-avivah-sicho-96db3843.koyeb.app";
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws';
const TARGET_SR = 16000;

const el = (id) => document.getElementById(id);
const logEl = el('log');
const statusEl = el('status');
const remotePttEl = el('remotePtt');
const techInfoEl = el('techInfo');

const channelEl = el('channel');
const connectBtn = el('connect');
const disconnectBtn = el('disconnect');
const pttBtn = el('ptt');

let ws = null;
let audioCtx = null; // Contexte unique partagé (Capture & Playback)

// Nodes AudioWorklet
let captureNode = null;
let captureSource = null;
let captureStream = null;

let playbackNode = null;

let sending = false;

function log(...args) {
  const txt = args.join(' ');
  logEl.textContent += txt + '\n';
  logEl.scrollTop = logEl.scrollHeight;
  console.log('[App]', txt);
}

function setStatus(s) {
  statusEl.textContent = s;
  if (s === 'connected') statusEl.style.color = 'green';
  else if (s === 'disconnected') statusEl.style.color = 'red';
  else statusEl.style.color = 'orange';
}

function wsSendJson(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

async function ensureAudioContext() {
  if (!audioCtx) {
    // Création du contexte
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
      sampleRate: 48000 // Force standard si possible, sinon le navigateur décide
    });

    // Chargement du module processeur (Unique fichier pour les 2 processors)
    try {
      await audioCtx.audioWorklet.addModule('./processors.js');
      techInfoEl.textContent = `CTX: ${audioCtx.sampleRate}Hz | Target: ${TARGET_SR}Hz`;
      log('AudioWorklet module loaded.');
    } catch (e) {
      log('ERREUR: Impossible de charger processors.js', e);
      techInfoEl.textContent = 'Erreur Worklet';
    }
  }

  if (audioCtx.state !== 'running') {
    await audioCtx.resume();
  }
  return audioCtx;
}

// ----------------------------------------------------------------------
// PLAYBACK (Réception)
// ----------------------------------------------------------------------
async function startPlaybackEngine() {
  const ctx = await ensureAudioContext();

  // Si déjà actif, rien à faire
  if (playbackNode) return;

  try {
    playbackNode = new AudioWorkletNode(ctx, 'playback-processor');
    playbackNode.connect(ctx.destination);
    log('Playback engine started (Jitter Buffer ready)');
  } catch (e) {
    log('Playback engine init fail:', e);
  }
}

// ----------------------------------------------------------------------
// CAPTURE (Émission)
// ----------------------------------------------------------------------
async function startCapture() {
  if (sending) return;

  const ctx = await ensureAudioContext();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    // Micro
    if (!captureStream) {
      captureStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
    }

    captureSource = ctx.createMediaStreamSource(captureStream);

    // Worklet Capture
    captureNode = new AudioWorkletNode(ctx, 'capture-processor');

    // Événement: Worklet envoie des données PCM au Main Thread
    captureNode.port.onmessage = (e) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data); // ArrayBuffer Int16
      }
    };

    captureSource.connect(captureNode);
    // Note: On ne connecte PAS à destination pour éviter retour voix local

    sending = true;
    pttBtn.style.background = '#16a34a'; // Vert
    pttBtn.textContent = 'EN ÉMISSION...';

  } catch (e) {
    log('Capture start error:', e);
    stopCapture();
  }
}

function stopCapture() {
  sending = false;
  pttBtn.style.background = ''; // Reset
  pttBtn.textContent = 'MAINTENIR POUR PARLER';

  if (captureNode) {
    captureNode.disconnect();
    captureNode = null;
  }
  if (captureSource) {
    captureSource.disconnect();
    captureSource = null;
  }
  // On garde le stream ouvert pour réactivité, ou on le coupe si on veut
  // captureStream.getTracks().forEach(t => t.stop()); captureStream = null; 
}


// ----------------------------------------------------------------------
// WEBSOCKET
// ----------------------------------------------------------------------
function connect() {
  if (ws) return;

  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  setStatus('connecting');
  connectBtn.disabled = true;

  ws.onopen = async () => {
    setStatus('connected');
    disconnectBtn.disabled = false;
    pttBtn.disabled = false;

    const channel = Math.max(1, Math.min(255, parseInt(channelEl.value, 10) || 1));
    wsSendJson({ type: 'join', channel, role: 'pwa_v3' });
    log('Connected to Channel', channel);

    // Démarrer moteur playback (écoute) immédiatement
    await startPlaybackEngine();
  };

  ws.onmessage = (evt) => {
    // 1. TEXTE (Signalo)
    if (typeof evt.data === 'string') {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'ptt') {
          remotePttEl.textContent = msg.state === 'start' ? 'EN LIGNE...' : 'silence';
          if (msg.state === 'start') {
             // Optionnel: Reset jitter buffer si nouvelle phrase ?
             // Non, le processor gère ça (auto-start quand buffer rempli)
          }
        }
      } catch {}
      return;
    }

    // 2. BINAIRE (Audio reçu)
    // On envoie direct au Playback Worklet
    if (playbackNode) {
      playbackNode.port.postMessage(evt.data);
    }
  };

  ws.onclose = () => {
    setStatus('disconnected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    pttBtn.disabled = true;
    ws = null;

    // Cleanup nodes
    if (playbackNode) { playbackNode.disconnect(); playbackNode = null; }
    stopCapture();
  };

  ws.onerror = () => {
    log('WS Error');
  };
}

function disconnect() {
  if (ws) ws.close();
}

// ----------------------------------------------------------------------
// UI EVENTS
// ----------------------------------------------------------------------
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

// PTT Logic
const startTx = (e) => {
  if (e.cancelable) e.preventDefault();
  startCapture();
};

const stopTx = (e) => {
  if (e.cancelable) e.preventDefault();
  stopCapture();
};

// Souris
pttBtn.addEventListener('mousedown', startTx);
pttBtn.addEventListener('mouseup', stopTx);
pttBtn.addEventListener('mouseleave', stopTx);

// Touch (Mobile) - Crucial: passive: false
pttBtn.addEventListener('touchstart', startTx, { passive: false });
pttBtn.addEventListener('touchend', stopTx, { passive: false });
pttBtn.addEventListener('touchcancel', stopTx, { passive: false });

// Anti-sélection barbare
document.addEventListener('contextmenu', event => event.preventDefault());
