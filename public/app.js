// GitHub Pages => chemins relatifs + backend externe (Koyeb)
const BACKEND = "https://mobile-avivah-sicho-96db3843.koyeb.app";
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws';

const el = (id) => document.getElementById(id);
const logEl = el('log');
const statusEl = el('status');
const remotePttEl = el('remotePtt');
const wsUrlEl = el('wsUrl');
const backendUrlEl = el('backendUrl');
const backendStatusEl = el('backendStatus');

const channelEl = el('channel');
const connectBtn = el('connect');
const disconnectBtn = el('disconnect');
const pttBtn = el('ptt');

backendUrlEl.textContent = BACKEND;
wsUrlEl.textContent = WS_URL;

let ws = null;
let stream = null;
let recorder = null;
let mimeType = pickMimeType();
let playQueue = Promise.resolve();

function log(...args) {
  logEl.textContent += args.join(' ') + '
';
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(s) {
  statusEl.textContent = s;
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (!('MediaRecorder' in window)) return '';
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

async function ensureMic() {
  if (stream) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return stream;
}

function wsSendJson(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function enqueuePlay(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: mimeType || 'audio/webm' });
  const url = URL.createObjectURL(blob);
  playQueue = playQueue.then(
    () =>
      new Promise((resolve) => {
        const a = new Audio(url);
        a.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        a.onerror = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        a.play().catch(() => resolve());
      })
  );
}

async function refreshBackendStatus() {
  try {
    const r = await fetch(BACKEND + '/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    backendStatusEl.textContent = j.status || 'ok';
  } catch {
    try {
      const r2 = await fetch(BACKEND + '/', { cache: 'no-store' });
      const j2 = await r2.json();
      backendStatusEl.textContent = j2.status || 'ok';
    } catch {
      backendStatusEl.textContent = 'unreachable';
    }
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  setStatus('connecting');
  connectBtn.disabled = true;

  ws.onopen = async () => {
    setStatus('connected');
    disconnectBtn.disabled = false;
    pttBtn.disabled = false;

    const channel = Math.max(1, Math.min(255, parseInt(channelEl.value, 10) || 1));
    wsSendJson({ type: 'join', channel, role: 'pwa' });

    await refreshBackendStatus();
    log('WS open, joined channel', channel, 'mime:', mimeType || 'default');
  };

  ws.onmessage = (evt) => {
    if (typeof evt.data === 'string') {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'joined') log('Joined OK:', msg.channel);
        if (msg.type === 'ptt') remotePttEl.textContent = msg.state || 'unknown';
      } catch {}
      return;
    }
    enqueuePlay(evt.data);
  };

  ws.onclose = () => {
    setStatus('disconnected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    pttBtn.disabled = true;
    remotePttEl.textContent = 'idle';
    log('WS closed');
  };

  ws.onerror = () => log('WS error');
}

function disconnect() {
  if (ws) ws.close();
  ws = null;
}

async function startPtt() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = await ensureMic();

  wsSendJson({ type: 'ptt', state: 'start' });

  recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size === 0) return;
    const buf = await e.data.arrayBuffer();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
  };
  recorder.start(250);
  pttBtn.textContent = 'PARLE… (relâche pour stopper)';
}

function stopPtt() {
  wsSendJson({ type: 'ptt', state: 'stop' });
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  pttBtn.textContent = 'Maintiens pour parler (PTT)';
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);

pttBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  startPtt();
});
pttBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  stopPtt();
});
pttBtn.addEventListener('pointercancel', stopPtt);
pttBtn.addEventListener('pointerleave', (e) => {
  if (e.buttons === 0) stopPtt();
});
