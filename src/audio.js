// ---------------------------------------------------------------------------
// Synthesised sound effects. No asset files - everything is generated with
// WebAudio oscillators and a shared noise buffer.
//
// Every sound is throttled, because at 3x speed a wall of MG Nests would
// otherwise try to fire a few hundred samples a second.
// ---------------------------------------------------------------------------

const THROTTLE = {
  shot: 0.045, snipe: 0.07, acid: 0.06, flame: 0.1, zap: 0.07,
  mortar: 0.09, boom: 0.06, die: 0.05, leak: 0.12, build: 0.02,
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.5;
    this.last = new Map();
  }

  /** Must be called from a user gesture (browsers block autoplay otherwise). */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // 1 second of white noise, reused by every noise-based sound.
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  now() { return this.ctx.currentTime; }

  gate(name) {
    const min = THROTTLE[name];
    if (!min) return true;
    const t = this.ctx.currentTime;
    if ((this.last.get(name) ?? -99) + min > t) return false;
    this.last.set(name, t);
    return true;
  }

  // -- primitives ----------------------------------------------------------

  burst({ dur = 0.1, gain = 0.3, type = 'lowpass', freq = 1200, q = 1, sweep = null }) {
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.8;

    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    filt.Q.value = q;
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  tone({ freq = 440, to = null, dur = 0.15, gain = 0.2, type = 'sine', delay = 0 }) {
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // -- the kit -------------------------------------------------------------

  play(name) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.gate(name)) return;

    switch (name) {
      case 'shot':
        this.burst({ dur: 0.06, gain: 0.16, freq: 2600, sweep: 500, q: 0.7 });
        break;
      case 'snipe':
        this.burst({ dur: 0.16, gain: 0.3, freq: 1800, sweep: 180, q: 1.4 });
        this.tone({ freq: 180, to: 60, dur: 0.14, gain: 0.14, type: 'triangle' });
        break;
      case 'acid':
        this.tone({ freq: 700, to: 260, dur: 0.11, gain: 0.1, type: 'sawtooth' });
        break;
      case 'flame':
        this.burst({ dur: 0.22, gain: 0.09, type: 'bandpass', freq: 700, q: 0.8 });
        break;
      case 'zap':
        this.tone({ freq: 2400, to: 340, dur: 0.12, gain: 0.13, type: 'sawtooth' });
        this.burst({ dur: 0.07, gain: 0.1, type: 'highpass', freq: 3000 });
        break;
      case 'mortar':
        this.tone({ freq: 150, to: 70, dur: 0.16, gain: 0.2, type: 'triangle' });
        break;
      case 'boom':
        this.burst({ dur: 0.4, gain: 0.32, freq: 900, sweep: 60, q: 0.6 });
        this.tone({ freq: 90, to: 35, dur: 0.32, gain: 0.22, type: 'sine' });
        break;
      case 'die':
        this.tone({
          freq: 150 + Math.random() * 60, to: 60, dur: 0.16,
          gain: 0.07, type: 'sawtooth',
        });
        break;
      case 'bossdie':
        this.tone({ freq: 130, to: 40, dur: 0.9, gain: 0.26, type: 'sawtooth' });
        this.burst({ dur: 0.7, gain: 0.3, freq: 700, sweep: 50 });
        break;
      case 'leak':
        this.tone({ freq: 320, to: 150, dur: 0.3, gain: 0.24, type: 'square' });
        this.tone({ freq: 240, to: 110, dur: 0.34, gain: 0.18, type: 'square', delay: 0.09 });
        break;
      case 'build':
        this.tone({ freq: 520, to: 760, dur: 0.09, gain: 0.14, type: 'square' });
        break;
      case 'sell':
        this.tone({ freq: 700, to: 380, dur: 0.11, gain: 0.13, type: 'square' });
        break;
      case 'upgrade':
        this.tone({ freq: 520, dur: 0.1, gain: 0.14, type: 'triangle' });
        this.tone({ freq: 780, dur: 0.13, gain: 0.14, type: 'triangle', delay: 0.07 });
        this.tone({ freq: 1040, dur: 0.16, gain: 0.12, type: 'triangle', delay: 0.15 });
        break;
      case 'wavestart':
        this.tone({ freq: 150, dur: 0.5, gain: 0.2, type: 'sawtooth' });
        this.tone({ freq: 226, dur: 0.6, gain: 0.16, type: 'sawtooth', delay: 0.16 });
        break;
      case 'waveclear':
        this.tone({ freq: 600, dur: 0.14, gain: 0.16, type: 'sine' });
        this.tone({ freq: 900, dur: 0.2, gain: 0.14, type: 'sine', delay: 0.1 });
        break;
      case 'gameover':
        this.tone({ freq: 300, to: 60, dur: 1.6, gain: 0.3, type: 'sawtooth' });
        break;
      case 'ui':
        this.tone({ freq: 880, dur: 0.05, gain: 0.07, type: 'square' });
        break;
      case 'deny':
        this.tone({ freq: 200, to: 130, dur: 0.14, gain: 0.16, type: 'square' });
        break;
      default:
        break;
    }
  }
}
