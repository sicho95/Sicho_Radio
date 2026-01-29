
// processors.js - Capture et Playback haute fluidité

// ---------------------------------------------------------
// 1. CAPTURE PROCESSOR (Microphone -> PCM)
// ---------------------------------------------------------
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    // Calcul précis du ratio
    this.remainder = 0; 
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputData = input[0]; // Float32 Mono
    const inputSampleRate = sampleRate; // Global scope
    const ratio = inputSampleRate / this.targetSampleRate;

    // Estimation taille sortie
    const outputLength = Math.ceil((inputData.length - this.remainder) / ratio);
    const outputData = new Int16Array(outputLength);

    let outputIndex = 0;
    let inputIndex = this.remainder;

    while (inputIndex < inputData.length) {
      // Linear interpolation simple pour éviter aliasing trop violent du 'nearest neighbor'
      // et surtout rester rapide.
      const val = inputData[Math.floor(inputIndex)];

      // Clamp & Convert to Int16
      const s = Math.max(-1, Math.min(1, val));
      outputData[outputIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      inputIndex += ratio;
    }

    this.remainder = inputIndex - inputData.length;

    // On envoie seulement si on a rempli des données
    if (outputIndex > 0) {
      // Si outputIndex < outputLength (arrondi), on slice pour envoyer propre
      const finalBuffer = (outputIndex === outputLength) 
        ? outputData.buffer 
        : outputData.slice(0, outputIndex).buffer;

      this.port.postMessage(finalBuffer, [finalBuffer]);
    }

    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);


// ---------------------------------------------------------
// 2. PLAYBACK PROCESSOR (Jitter Buffer -> Speakers)
// ---------------------------------------------------------
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Buffer circulaire de 2 secondes max
    this.bufferSize = 16000 * 2; 
    this.buffer = new Float32Array(this.bufferSize);
    this.writePointer = 0;
    this.readPointer = 0;
    this.available = 0;

    // Paramètres Jitter Buffer
    this.minBufferToStart = 2400; // 150ms de pré-chargement
    this.isPlaying = false;
    this.underrunCount = 0;

    this.port.onmessage = (e) => {
      const int16 = new Int16Array(e.data);
      this.pushData(int16);
    };
  }

  pushData(int16Data) {
    for (let i = 0; i < int16Data.length; i++) {
      // Conversion Int16 -> Float32
      this.buffer[this.writePointer] = int16Data[i] / 32768.0;
      this.writePointer = (this.writePointer + 1) % this.bufferSize;
      this.available++;

      // Sécurité overflow : si on écrit par dessus le curseur de lecture (buffer full)
      if (this.available > this.bufferSize) {
        this.readPointer = (this.readPointer + 1) % this.bufferSize;
        this.available = this.bufferSize;
      }
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const outputChannel = output[0];
    const len = outputChannel.length;

    // Logique Jitter Buffer
    if (!this.isPlaying) {
      if (this.available >= this.minBufferToStart) {
        this.isPlaying = true; // Démarrage lecture
        // console.log('Jitter Buffer filled, starting playback');
      } else {
        // Pas assez de données, silence
        outputChannel.fill(0);
        return true;
      }
    }

    // Lecture
    if (this.isPlaying) {
      if (this.available >= len) {
        // On a assez de données pour ce frame
        for (let i = 0; i < len; i++) {
          outputChannel[i] = this.buffer[this.readPointer];
          this.readPointer = (this.readPointer + 1) % this.bufferSize;
        }
        this.available -= len;
      } else {
        // UNDERRUN (Panne sèche)
        // On joue ce qu'il reste, puis silence et on repasse en buffering
        let i = 0;
        for (; i < this.available; i++) {
          outputChannel[i] = this.buffer[this.readPointer];
          this.readPointer = (this.readPointer + 1) % this.bufferSize;
        }
        for (; i < len; i++) {
          outputChannel[i] = 0;
        }
        this.available = 0;
        this.isPlaying = false; // Retour en buffering
        this.underrunCount++;
      }
    }

    return true;
  }
}

registerProcessor('playback-processor', PlaybackProcessor);
