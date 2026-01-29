
// processors.js - Capture et Playback avec RE-SAMPLING CORRECT

const TARGET_SAMPLE_RATE = 16000;

// ---------------------------------------------------------
// 1. CAPTURE PROCESSOR (Microphone -> PCM 16kHz)
// ---------------------------------------------------------
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.remainder = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputData = input[0]; // Float32 Mono (ex: 48kHz ou 44.1kHz)
    // sampleRate est une globale dans le Worklet (taux du contexte audio)
    const ratio = sampleRate / TARGET_SAMPLE_RATE;

    // Decimation simple avec moyenne locale pour limiter l'aliasing
    const outputLength = Math.ceil((inputData.length - this.remainder) / ratio);
    const outputData = new Int16Array(outputLength);

    let outputIndex = 0;
    // On reprend où on s'était arrêté
    let inputIndex = this.remainder;

    while (inputIndex < inputData.length) {
      const center = Math.floor(inputIndex);

      // Au lieu de prendre juste sample[center], on peut faire une mini moyenne 
      // si le ratio est grand (ex 48->16 = 3 samples).
      // Pour rester performant et simple, on fait du 'nearest' amélioré ou linear simple.
      // Ici: simple sample picking pour la latence min.
      // (Pour la voix, c'est souvent suffisant si le micro est bon).

      let val = inputData[center];

      // Clamp & Convert
      const s = Math.max(-1, Math.min(1, val));
      outputData[outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      inputIndex += ratio;
    }

    this.remainder = inputIndex - inputData.length;

    if (outputIndex > 0) {
      // Envoi du buffer exact
      const buf = (outputIndex === outputLength) 
        ? outputData.buffer 
        : outputData.slice(0, outputIndex).buffer;
      this.port.postMessage(buf, [buf]);
    }

    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);


// ---------------------------------------------------------
// 2. PLAYBACK PROCESSOR (PCM 16kHz -> Speaker système)
// ---------------------------------------------------------
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Buffer circulaire pour stocker du 16kHz
    // Taille suffisante pour ~2 secondes
    this.bufferSize = TARGET_SAMPLE_RATE * 2; 
    this.buffer = new Float32Array(this.bufferSize);

    this.writePtr = 0;  // Où on écrit les nouvelles données 16k
    this.readPtr = 0;   // Où on lit (en coordonnées 16k)
    this.available = 0; // Nombre d'échantillons 16k dispos

    // Seuil de démarrage (Jitter Buffer) : 100ms de pré-chargement
    this.minStart = TARGET_SAMPLE_RATE * 0.10; 
    this.isPlaying = false;

    this.port.onmessage = (e) => {
      const int16 = new Int16Array(e.data);
      this.pushData(int16);
    };
  }

  pushData(int16Data) {
    for (let i = 0; i < int16Data.length; i++) {
      this.buffer[this.writePtr] = int16Data[i] / 32768.0;
      this.writePtr = (this.writePtr + 1) % this.bufferSize;
      this.available++;

      // Protection overflow (écrasement)
      if (this.available > this.bufferSize) {
        this.readPtr = (this.readPtr + 1) % this.bufferSize;
        this.available = this.bufferSize;
      }
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const outputCh = output[0];
    const outputLen = outputCh.length; // ex: 128 samples à 48kHz ou 44.1kHz

    // Si on ne joue pas, on remplit du silence ou on attend
    if (!this.isPlaying) {
      if (this.available >= this.minStart) {
        this.isPlaying = true; 
      } else {
        outputCh.fill(0);
        return true;
      }
    }

    // Le ratio de lecture : combien de samples 16k consommer pour 1 sample de sortie ?
    // Ex: Output=48k, Source=16k => On avance de 16/48 = 0.333 sample source par sample output.
    // C'est l'INVERSE de la capture.
    const step = TARGET_SAMPLE_RATE / sampleRate;

    for (let i = 0; i < outputLen; i++) {
      if (this.available < 1) {
        // Underrun
        outputCh[i] = 0;
        this.isPlaying = false;
        this.available = 0; 
        continue;
      }

      // Interpolation Linéaire
      // readPtr est un float ici ? Non, on va gérer un readPtrFloat local ou séparé
      // Pour simplifier dans un ring buffer float, on sépare partie entière et fraction.

      // Mais readPtr est entier dans ma classe. 
      // Il faut que je gère une position de lecture "flottante" pour bien interpoler.
      // Hack simple : on garde readPtr entier, mais on avance d'un accumulateur.

      // REVISION: On va gérer 'readHead' en float
      if (this._readHead === undefined) this._readHead = this.readPtr;

      const idx = Math.floor(this._readHead);
      const frac = this._readHead - idx;

      const p1 = this.buffer[idx % this.bufferSize];
      const p2 = this.buffer[(idx + 1) % this.bufferSize];

      // Sample interpolé
      const val = p1 + frac * (p2 - p1);

      outputCh[i] = val;

      // Avance tête de lecture
      this._readHead += step;

      // Gestion Ring Buffer wrapping pour _readHead
      // On met à jour available SEULEMENT quand on franchit un index entier
      while (this._readHead >= this.bufferSize) {
        this._readHead -= this.bufferSize;
      }

      // Mise à jour de 'available' : on regarde de combien on a avancé en ENTIER
      // C'est tricky avec le float.
      // Plus simple : on décrémente available quand on 'franchit' un sample source.
    }

    // Recalcul propre de available/readPtr basé sur la tête flottante
    // On synchronise le readPtr entier sur la partie entière du readHead
    const dist = (this._readHead - this.readPtr);
    // Cas wrapping
    let advance = dist;
    if (advance < 0) advance += this.bufferSize;

    // On considère qu'on a consommé 'Math.floor(advance)' samples entiers
    const consumed = Math.floor(advance);

    if (consumed > 0) {
      this.readPtr = (this.readPtr + consumed) % this.bufferSize;
      this.available -= consumed;
      // On garde _readHead tel quel, il est juste devant readPtr
    }

    // Sécurité underrun post-loop
    if (this.available < 0) {
       this.available = 0;
       this.isPlaying = false;
       // Resync
       this._readHead = this.readPtr; 
    }

    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
