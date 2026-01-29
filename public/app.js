// V6: Hybrid PTT / Full Duplex Lock
const BACKEND = "https://mobile-avivah-sicho-96db3843.koyeb.app";
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws';

const el = (id) => document.getElementById(id);
const logEl = el('log');
const statusText = el('statusText');
const statusDot = el('statusDot');
const remotePttEl = el('remotePtt');
const pttBtn = el('ptt');
const connectBtn = el('connect');
const disconnectBtn = el('disconnect');
const channelEl = el('channel');
const lockHint = el('lockHint');

let ws = null;
let audioCtx = null;
let captureNode = null;
let captureSource = null;
let captureStream = null;
let playbackNode = null;

// Lock Logic Variables
let holdTimer = null;
let isLocked = false; 
let isTransmitting = false;
const LOCK_DELAY_MS = 10000; // 10 secondes pour verrouiller

function log(msg) {
  const d = new Date().toLocaleTimeString();
  logEl.innerHTML += `<div><span style="color:#9ca3af">[${d}]</span> ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(s) {
  if (s === 'connected') {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'En ligne';
  } else {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = s === 'connecting' ? 'Connexion...' : 'Hors ligne';
  }
}

async function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    try {
      await audioCtx.audioWorklet.addModule('./processors.js');
      log('Audio Ready (' + audioCtx.sampleRate + 'Hz)');
    } catch (e) {
      log('Audio Init Fail: ' + e.message);
      return false;
    }
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  return true;
}

async function startPlayback() {
  if (!(await initAudio())) return;
  if (playbackNode) return;

  try {
    playbackNode = new AudioWorkletNode(audioCtx, 'playback-processor');
    playbackNode.connect(audioCtx.destination);
  } catch(e) { log('Playback Error: ' + e); }
}

async function startCapture() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (isTransmitting) return; // Déjà en cours

  if (!(await initAudio())) return;

  try {
    if (!captureStream) {
      captureStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    }

    if (!captureNode) {
        captureSource = audioCtx.createMediaStreamSource(captureStream);
        captureNode = new AudioWorkletNode(audioCtx, 'capture-processor');

        captureNode.port.onmessage = (e) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };

        captureSource.connect(captureNode);
    }

    ws.send(JSON.stringify({ type: 'ptt', state: 'start' }));
    isTransmitting = true;

    pttBtn.classList.add('active');
    pttBtn.textContent = isLocked ? 'VERROUILLÉ (FULL DUPLEX)' : 'TRANSMISSION...';
  } catch (e) {
    log('Mic Error: ' + e.message);
    stopCapture(true); // Force stop
  }
}

function stopCapture(force = false) {
  // Si verrouillé et pas forcé, on ne coupe pas
  if (isLocked && !force) return;

  isTransmitting = false;
  pttBtn.classList.remove('active');
  pttBtn.classList.remove('locked');
  pttBtn.textContent = 'PTT';

  if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ptt', state: 'stop' }));
  }

  // Reset lock state
  isLocked = false;
  lockHint.classList.remove('show');
}

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

    const ch = channelEl.value;
    ws.send(JSON.stringify({ type: 'join', channel: parseInt(ch), role: 'v6' }));

    await startPlayback();
  };

  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'ptt') {
          remotePttEl.textContent = m.state === 'start' ? 'Réception en cours...' : '';
        }
      } catch {}
    } else {
      if (playbackNode) playbackNode.port.postMessage(e.data);
    }
  };

  ws.onclose = () => {
    setStatus('disconnected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    pttBtn.disabled = true;
    ws = null;
    isLocked = false;
    stopCapture(true);
  };
}

// HANDLERS
connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', () => ws && ws.close());
pttBtn.addEventListener('contextmenu', e => e.preventDefault());

// --- LOGIQUE HYBRIDE PTT / LOCK ---

const handlePress = (e) => {
  if (e.cancelable) e.preventDefault();

  // Si déjà verrouillé, un clic déverrouille et arrête
  if (isLocked) {
    stopCapture(true); // Force unlock & stop
    return;
  }

  // Sinon, démarrage PTT standard
  startCapture();

  // Démarrage timer pour verrouillage
  lockHint.textContent = `Maintiens ${LOCK_DELAY_MS/1000}s pour verrouiller`;
  lockHint.classList.add('show');

  holdTimer = setTimeout(() => {
    isLocked = true;
    pttBtn.classList.add('locked');
    pttBtn.textContent = 'VERROUILLÉ (Cliquer pour arrêter)';
    lockHint.textContent = 'Mode Full Duplex activé';
    // Vibration haptique si supportée
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  }, LOCK_DELAY_MS);
};

const handleRelease = (e) => {
  if (e.cancelable) e.preventDefault();

  // Annule le timer de verrouillage si relâché avant 10s
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  // Si verrouillé, on ne fait rien (il faut recliquer pour arrêter)
  if (isLocked) return;

  // Sinon, arrêt PTT standard
  stopCapture();
  lockHint.classList.remove('show');
};


// Touch
pttBtn.addEventListener('touchstart', handlePress, { passive: false });
pttBtn.addEventListener('touchend', handleRelease);
pttBtn.addEventListener('touchcancel', handleRelease);

// Mouse
pttBtn.addEventListener('mousedown', (e) => {
  if (e.button === 0) handlePress(e);
});
pttBtn.addEventListener('mouseup', handleRelease);
pttBtn.addEventListener('mouseleave', handleRelease);
