/* ═══════════════════════════════════════════════════════════════════════
   MediTone Engine — generative ambient / meditation music
   Pure Web Audio API. No samples, no external libraries.

   Works in the browser (AudioContext / OfflineAudioContext) and in Node
   (e.g. with the "node-web-audio-api" package) for offline rendering.

   Musical concept
   ───────────────
   • Drone        root + fifth, always present, slowly breathing filter
   • Pad          4 voices, each voice moves on its own random schedule by
                  small steps inside the selected mode (voice leading).
                  No common chord grid → no hidden rhythm.
   • Halo         quiet octave/twelfth sines sent only to the hall reverb
                  (shimmer-like ghost layer above the pad)
   • Lead voices  bansuri flute, shakuhachi, handpan. Phrases come from a
                  motif memory (new motifs + variations of known motifs),
                  with call & response between two instruments.
   • Bowls        singing bowls from inharmonic partials with beating
   • Tanpura      optional jawari-like drone plucks
   • Ocean        irregular wave swells (no periodic LFO)
   • Binaural     optional, carrier tuned to the root
   • Space        depth planes (near / mid / far) with shared long hall,
                  short room and an irregular feedback echo
   • Form         a session arc (Arriving → Deepening → Stillness →
                  Returning) controls density and brightness over time
   • Seed         same seed + same settings → same piece
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── Random numbers (seeded) ─────────────────────────────────────── */

  // String → 32-bit hash (cyrb53, reduced to 32 bit)
  function hashSeed(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  class Rng {
    constructor(seed) { this.s = seed >>> 0; }
    // mulberry32
    float() {
      let t = (this.s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.float(); }
    int(a, b) { return Math.floor(this.range(a, b + 1)); }
    chance(p) { return this.float() < p; }
    pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }
    // pairs: [[value, weight], ...]
    weighted(pairs) {
      let sum = 0;
      for (const p of pairs) sum += p[1];
      if (sum <= 0) return pairs.length ? pairs[0][0] : undefined;
      let r = this.float() * sum;
      for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
      return pairs[pairs.length - 1][0];
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────────── */

  const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mod = (n, m) => ((n % m) + m) % m;
  // Slider range is -40 … 0 dB; -40 means "off"
  const MUTE_DB = -40;
  const dbToGain = db => (db <= MUTE_DB ? 0 : Math.pow(10, db / 20));

  /* ── Musical material ────────────────────────────────────────────── */

  const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const MODES = {
    dorian:     { name: 'Dorian · warm',          steps: [0, 2, 3, 5, 7, 9, 10] },
    aeolian:    { name: 'Aeolian · deep',         steps: [0, 2, 3, 5, 7, 8, 10] },
    pentaMajor: { name: 'Pentatonic · light',     steps: [0, 2, 4, 7, 9] },
    pentaMinor: { name: 'Minor pentatonic · calm', steps: [0, 3, 5, 7, 10] },
    lydian:     { name: 'Lydian · floating',      steps: [0, 2, 4, 6, 7, 9, 11] },
    hijaz:      { name: 'Hijaz · oriental',       steps: [0, 1, 4, 5, 7, 8, 10] },
  };

  const LAYERS = {
    drone:    { label: 'Drone',         sub: 'Root · Fifth' },
    pad:      { label: 'Pad',           sub: 'Voice-led · Halo' },
    flute:    { label: 'Flutes',        sub: 'Bansuri · Shakuhachi' },
    handpan:  { label: 'Handpan',       sub: 'Modal synthesis' },
    bowl:     { label: 'Singing Bowls', sub: 'Inharmonic · Beating' },
    tanpura:  { label: 'Tanpura',       sub: 'Jawari drone' },
    ocean:    { label: 'Ocean',         sub: 'Irregular swells' },
    binaural: { label: 'Binaural',      sub: 'Headphones' },
  };

  const DEFAULT_LEVELS = {
    drone: -11, pad: -6, flute: -6, handpan: -10, bowl: -8,
    tanpura: MUTE_DB, ocean: -26, binaural: -30,
  };

  class Scale {
    constructor(rootPc, steps) {
      this.rootPc = rootPc;
      this.steps = steps;
      this.n = steps.length;
      // Stable scale positions: root, fifth, third (if present)
      this.stableIdx = [];
      steps.forEach((s, i) => { if (s === 0 || s === 7 || s === 3 || s === 4) this.stableIdx.push(i); });
      this.fifthIdx = steps.indexOf(7);
      this.thirdIdx = steps.indexOf(4) >= 0 ? steps.indexOf(4) : steps.indexOf(3);
    }
    // Scale degree (may be negative or > n) → MIDI, relative to baseMidi (= root)
    midi(deg, baseMidi) {
      const o = Math.floor(deg / this.n);
      return baseMidi + 12 * o + this.steps[mod(deg, this.n)];
    }
    pcOf(midi) { return mod(midi - this.rootPc, 12); }
    contains(midi) { return this.steps.includes(this.pcOf(midi)); }
    notesInRange(lo, hi) {
      const out = [];
      for (let m = lo; m <= hi; m++) if (this.contains(m)) out.push(m);
      return out;
    }
    isStable(deg) { return this.stableIdx.includes(mod(deg, this.n)); }
    snapStable(deg) {
      for (let d = 0; d <= this.n; d++) {
        if (this.isStable(deg - d)) return deg - d;
        if (this.isStable(deg + d)) return deg + d;
      }
      return deg;
    }
    nearestInScale(midi) {
      for (let d = 0; d < 6; d++) {
        if (this.contains(midi - d)) return midi - d;
        if (this.contains(midi + d)) return midi + d;
      }
      return midi;
    }
  }

  /* ── Session arc ─────────────────────────────────────────────────── */
  // [position 0..1, density 0..1, brightness 0..1]
  const ARC = [
    [0.00, 0.15, 0.30],
    [0.12, 0.45, 0.55],
    [0.35, 0.85, 0.85],
    [0.50, 1.00, 1.00],
    [0.60, 0.30, 0.55],
    [0.78, 0.20, 0.35],
    [0.88, 0.50, 0.60],
    [1.00, 0.30, 0.45],
  ];
  const ENDLESS_CYCLE = 1500; // seconds per arc cycle in endless mode

  function arcPosition(ts, duration) {
    if (isFinite(duration)) return clamp(ts / duration, 0, 1);
    if (ts < ENDLESS_CYCLE) return ts / ENDLESS_CYCLE;
    // After the first cycle skip the "arriving" part
    const span = ENDLESS_CYCLE * 0.88;
    return 0.12 + 0.88 * (((ts - ENDLESS_CYCLE) % span) / span);
  }

  function arcAt(ts, duration) {
    const p = arcPosition(ts, duration);
    let i = 0;
    while (i < ARC.length - 2 && p > ARC[i + 1][0]) i++;
    const a = ARC[i], b = ARC[i + 1];
    const t = clamp((p - a[0]) / (b[0] - a[0]), 0, 1);
    const phase = p < 0.12 ? 'Arriving' : p < 0.55 ? 'Deepening' : p < 0.80 ? 'Stillness' : 'Returning';
    return { p, density: lerp(a[1], b[1], t), bright: lerp(a[2], b[2], t), phase };
  }

  /* ── Impulse responses / noise ───────────────────────────────────── */

  // Stereo exponential-decay noise IR with growing high-frequency damping.
  // Normalised to unit energy.
  function makeImpulse(ctx, seconds, t60, preDelay, damping) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, energy = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        if (t < preDelay) { d[i] = 0; continue; }
        const tt = t - preDelay;
        const env = Math.exp(-6.9 * tt / t60) * Math.min(1, tt / 0.03);
        const coef = Math.min(0.985, damping * (tt / seconds) + 0.15);
        lp = coef * lp + (1 - coef) * (Math.random() * 2 - 1);
        const v = lp * env;
        d[i] = v;
        energy += v * v;
      }
      const norm = 1 / Math.sqrt(energy || 1);
      for (let i = 0; i < len; i++) d[i] *= norm;
    }
    return buf;
  }

  function makeWhiteNoise(ctx, seconds) {
    const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Pink noise (Paul Kellet's refined method)
  function makePinkNoise(ctx, seconds) {
    const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  /* ── Shared output chain (glue compressor + limiter) ─────────────── */

  function createOutput(ctx, withAnalyser) {
    const input = ctx.createGain();
    input.gain.value = 1.4; // make-up gain
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 12; glue.ratio.value = 2.5;
    glue.attack.value = 0.25; glue.release.value = 1.0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.003; limiter.release.value = 0.3;
    input.connect(glue); glue.connect(limiter); limiter.connect(ctx.destination);
    let analyser = null;
    if (withAnalyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      limiter.connect(analyser);
    }
    return { input, analyser };
  }

  /* ═══════════════════════════════════════════════════════════════════
     ENGINE
     ═══════════════════════════════════════════════════════════════════ */

  class Engine {
    /**
     * @param ctx          AudioContext or OfflineAudioContext
     * @param destination  AudioNode to connect to (e.g. createOutput().input)
     * @param cfg          { seed, rootPc, mode, duration (s or Infinity),
     *                       movement 0..1, density 0..1, reverb 0..1,
     *                       beat (Hz), offset (s, session start position),
     *                       levels { layer: dB } }
     */
    constructor(ctx, destination, cfg) {
      this.ctx = ctx;
      this.dest = destination;
      cfg = cfg || {};
      this.cfg = Object.assign({
        seed: 'meditone', rootPc: 2, mode: 'dorian', duration: 1200,
        movement: 0.5, density: 0.5, reverb: 0.6, beat: 4, offset: 0,
      }, cfg);
      this.cfg.levels = Object.assign({}, DEFAULT_LEVELS, cfg.levels || {});
      this.rng = new Rng(hashSeed(String(this.cfg.seed)) ^ Math.floor(this.cfg.offset * 1000));
      this.scale = new Scale(this.cfg.rootPc, (MODES[this.cfg.mode] || MODES.dorian).steps);
      this.sources = new Set();
      this.layerNodes = {};
      this.motifs = [];
      this.voices = [];
      this.next = {};
      this.stopped = false;
      this.arcNow = arcAt(0, this.cfg.duration);
    }

    /* ── Time helpers ── */
    sessionTime(t) { return t - this.t0 + this.cfg.offset; }
    get finite() { return isFinite(this.cfg.duration); }
    status(t) {
      const ts = this.sessionTime(t);
      const a = arcAt(ts, this.cfg.duration);
      return { ts, phase: a.phase, p: a.p, ended: this.finite && ts >= this.cfg.duration };
    }
    muted(layer) { return this.cfg.levels[layer] <= MUTE_DB; }

    // Register a source node for later disposal and start/stop it
    src(node, start, stop) {
      this.sources.add(node);
      node.onended = () => this.sources.delete(node);
      node.start(start);
      if (stop !== undefined) node.stop(stop);
      return node;
    }

    gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
    filter(type, freq, q) {
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      if (q !== undefined) f.Q.value = q;
      return f;
    }
    osc(type, freq) {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = freq;
      return o;
    }
    panner(p) {
      const sp = this.ctx.createStereoPanner();
      sp.pan.value = clamp(p, -1, 1);
      return sp;
    }
    // Slow LFO (sine) → gain(depth) → target param. Returns the oscillator.
    lfo(freq, depth, target, start, stop) {
      const o = this.osc('sine', freq);
      const g = this.gain(depth);
      o.connect(g); g.connect(target);
      this.src(o, start, stop);
      return o;
    }

    /* ── Graph ──────────────────────────────────────────────────────── */

    build() {
      const ctx = this.ctx;
      this.out = this.gain(0);
      this.out.connect(this.dest);

      this.dryBus = this.gain(1);
      this.dryBus.connect(this.out);

      // Long hall
      this.hall = ctx.createConvolver();
      this.hall.normalize = false;
      this.hall.buffer = makeImpulse(ctx, 10, 9, 0.045, 0.7);
      this.hallReturn = this.gain(1.25 * this.cfg.reverb);
      this.hall.connect(this.hallReturn); this.hallReturn.connect(this.out);

      // Short room for the "near" plane
      this.room = ctx.createConvolver();
      this.room.normalize = false;
      this.room.buffer = makeImpulse(ctx, 2.2, 1.6, 0.012, 0.6);
      this.roomReturn = this.gain(0.45);
      this.room.connect(this.roomReturn); this.roomReturn.connect(this.out);

      // Irregular stereo echo (delay times are not in a simple ratio)
      this.echoIn = this.gain(1);
      const echoOut = this.gain(0.5);
      [[1.37, -0.6], [1.91, 0.6]].forEach(([time, pan]) => {
        const d = ctx.createDelay(4); d.delayTime.value = time;
        const lp = this.filter('lowpass', 1800, 0.5);
        const fb = this.gain(0.32);
        const p = this.panner(pan);
        this.echoIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
        lp.connect(p); p.connect(echoOut);
      });
      echoOut.connect(this.out);
      const echoToHall = this.gain(0.35);
      echoOut.connect(echoToHall); echoToHall.connect(this.hall);

      // Depth planes: [dry, hall, room, echo]
      const P = {
        base: [0.80, 0.22, 0.00, 0.00],
        near: [0.90, 0.22, 0.35, 0.06],
        mid:  [0.55, 0.50, 0.12, 0.14],
        far:  [0.20, 0.95, 0.00, 0.22],
        halo: [0.00, 1.00, 0.00, 0.00],
        dry:  [1.00, 0.00, 0.00, 0.00],
      };
      this.planes = {};
      for (const name of Object.keys(P)) {
        const input = this.gain(1);
        let head = input;
        if (name === 'far') { head = this.filter('lowpass', 2000, 0.5); input.connect(head); }
        const [dry, hall, room, echo] = P[name];
        const send = (amt, target) => { if (amt > 0) { const g = this.gain(amt); head.connect(g); g.connect(target); } };
        send(dry, this.dryBus); send(hall, this.hall); send(room, this.room); send(echo, this.echoIn);
        this.planes[name] = input;
      }

      this.whiteNoise = makeWhiteNoise(ctx, 4);
      this.pinkNoise = makePinkNoise(ctx, 10);

      // Pad bus with macro brightness filter
      this.padTone = this.filter('lowpass', 900, 0.4);
      this.padTone.connect(this.layer('pad', 'mid'));
    }

    // Layer gain node in front of a plane (created on demand)
    layer(name, plane) {
      const key = name + ':' + plane;
      if (!this.layerNodes[key]) {
        const g = this.gain(dbToGain(this.cfg.levels[name]));
        g.connect(this.planes[plane]);
        this.layerNodes[key] = g;
      }
      return this.layerNodes[key];
    }

    /* ── Lifecycle ──────────────────────────────────────────────────── */

    start(t0) {
      this.t0 = t0;
      this.build();
      const resume = this.cfg.offset > 0;
      const fadeIn = resume ? 3 : 4;
      this.out.gain.setValueAtTime(0, t0);
      this.out.gain.linearRampToValueAtTime(1, t0 + fadeIn);

      this.startDrone(t0, resume ? 4 : 14);
      this.initPad(t0, resume);
      this.startOcean(t0);
      this.startBinaural(t0);

      this.next.macro = t0;
      this.next.phrase = t0 + (resume ? this.rng.range(4, 10) : this.rng.range(16, 26));
      this.next.bowl = t0 + (resume ? this.rng.range(6, 15) : 1.5);
      this.next.tanpura = t0 + (resume ? 1 : 6);
      this.tanIdx = 0;

      if (this.finite) {
        this.endT = t0 + (this.cfg.duration - this.cfg.offset);
        const fadeStart = Math.max(t0 + fadeIn + 0.1, this.endT - 40);
        this.out.gain.setValueAtTime(1, fadeStart);
        this.out.gain.linearRampToValueAtTime(0, this.endT);
        const lastBowl = this.endT - 44;
        if (lastBowl > t0 + 10 && !this.muted('bowl')) {
          this.strikeBowl(this.bowlNote(true), lastBowl, false, 1, 'mid', 0);
        }
      } else {
        this.endT = Infinity;
      }
    }

    // Schedule all events up to ctx time `until`
    advance(until) {
      if (this.stopped) return;
      until = Math.min(until, this.endT + 1);
      let guard = 0;
      while (this.next.macro < until && guard++ < 10000) { this.macroTick(this.next.macro); this.next.macro += 2; }
      for (const v of this.voices) {
        guard = 0;
        while (v.nextChange < until && guard++ < 1000) this.padStep(v);
      }
      guard = 0;
      while (this.next.phrase < until && guard++ < 1000) this.next.phrase = this.phraseEvent(this.next.phrase);
      guard = 0;
      while (this.next.bowl < until && guard++ < 1000) this.next.bowl = this.bowlEvent(this.next.bowl);
      guard = 0;
      while (this.next.wave < until && guard++ < 2000) this.next.wave = this.waveEvent(this.next.wave);
      guard = 0;
      while (this.next.tanpura < until && guard++ < 5000) this.next.tanpura = this.tanpuraEvent(this.next.tanpura);
    }

    // Fade out and release all nodes (real-time use)
    stop(fade) {
      if (this.stopped) return Promise.resolve();
      this.stopped = true;
      fade = fade === undefined ? 3 : fade;
      const now = this.ctx.currentTime;
      const g = this.out.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
      g.linearRampToValueAtTime(0, now + fade);
      return new Promise(resolve => {
        setTimeout(() => {
          this.sources.forEach(s => { try { s.stop(); } catch (_) { /* already stopped */ } });
          this.sources.clear();
          try { this.out.disconnect(); } catch (_) { /* ignore */ }
          resolve();
        }, (fade + 0.25) * 1000);
      });
    }

    /* ── Live parameter changes ─────────────────────────────────────── */

    setLevel(name, db) {
      this.cfg.levels[name] = db;
      const now = this.ctx.currentTime;
      for (const key of Object.keys(this.layerNodes)) {
        if (key.startsWith(name + ':')) this.layerNodes[key].gain.setTargetAtTime(dbToGain(db), now, 0.15);
      }
    }

    setParam(name, v) {
      const now = this.ctx.currentTime;
      this.cfg[name] = v;
      if (name === 'reverb') this.hallReturn.gain.setTargetAtTime(1.25 * v, now, 0.3);
      if (name === 'beat' && this.binR) this.binR.frequency.setTargetAtTime(this.binCarrier + v, now, 0.5);
      if (name === 'movement') {
        for (const voice of this.voices) {
          if (v > 0.01 && !isFinite(voice.nextChange)) voice.nextChange = now + this.padInterval() * 0.3;
          if (v <= 0.01) voice.nextChange = Infinity;
        }
      }
      if (name === 'density' && this.next.phrase > now + 10) {
        this.next.phrase = now + this.rng.range(4, 10);
      }
    }

    /* ── Macro arc ──────────────────────────────────────────────────── */

    macroTick(t) {
      const a = arcAt(this.sessionTime(t), this.cfg.duration);
      this.arcNow = a;
      const b = a.bright;
      this.padTone.frequency.setTargetAtTime(650 + 3600 * b * b, t, 4);
      if (this.droneTone) this.droneTone.frequency.setTargetAtTime(220 + 520 * b, t, 5);
    }

    effDensity() {
      return this.arcNow.density * (0.25 + 1.5 * this.cfg.density);
    }

    /* ── Drone ──────────────────────────────────────────────────────── */

    startDrone(t, fadeIn) {
      const pc = this.cfg.rootPc;
      const rootLow = 36 + pc - (pc >= 8 ? 12 : 0); // C2 … G2, G#1 … B1
      this.droneTone = this.filter('lowpass', 400, 0.5);
      const amp = this.gain(0);
      this.droneTone.connect(amp);
      amp.connect(this.layer('drone', 'base'));
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(1, t + fadeIn);
      this.lfo(this.rng.range(0.012, 0.02), 140, this.droneTone.frequency, t);

      const tones = [
        { m: rootLow,      types: ['sawtooth', 'sawtooth', 'sine'], lvl: 0.05 },
        { m: rootLow + 7,  types: ['sawtooth', 'sawtooth'],         lvl: 0.028 },
        { m: rootLow + 12, types: ['triangle'],                     lvl: 0.03 },
      ];
      for (const tone of tones) {
        const g = this.gain(tone.lvl);
        // Slow breathing of each tone, different rates → no common cycle
        this.lfo(this.rng.range(0.021, 0.067), tone.lvl * 0.35, g.gain, t);
        g.connect(this.droneTone);
        tone.types.forEach((type, i) => {
          const o = this.osc(type, midiToHz(tone.m));
          o.detune.value = type === 'sawtooth' ? (i === 0 ? -5 : 5) : 0;
          this.lfo(this.rng.range(0.05, 0.12), 3, o.detune, t);
          const og = this.gain(type === 'sine' ? 1.4 : 0.5);
          o.connect(og); og.connect(g);
          this.src(o, t);
        });
      }
    }

    /* ── Pad (independent voice leading) ───────────────────────────── */

    initPad(t, resume) {
      const padRoot = 48 + this.cfg.rootPc; // C3 … B3
      const third = this.scale.thirdIdx >= 0 ? this.scale.steps[this.scale.thirdIdx] : 2;
      const targets = [0, 7, 12, 12 + third];
      const used = new Set();
      for (let i = 0; i < targets.length; i++) {
        let m = this.scale.nearestInScale(padRoot + targets[i]);
        while (used.has(m)) m = this.scale.nearestInScale(m + 2);
        used.add(m);
        const start = t + (resume ? 0 : this.rng.range(0, 4));
        const fade = resume ? 4 : this.rng.range(9, 15);
        const voice = { midi: m, note: this.startPadNote(m, start, fade) };
        voice.nextChange = start + fade + this.padInterval();
        this.voices.push(voice);
      }
    }

    padInterval() {
      const mv = this.cfg.movement;
      if (mv <= 0.01) return Infinity;
      const base = lerp(170, 22, mv);
      const act = 0.6 + 0.6 * this.arcNow.density;
      return (base / act) * this.rng.range(0.6, 1.5);
    }

    padStep(v) {
      const t = v.nextChange;
      const m = this.choosePadNote(v);
      if (m === null) { v.nextChange = t + this.padInterval(); return; }
      const xfade = this.rng.range(9, 18);
      this.endPadNote(v.note, t, xfade);
      v.note = this.startPadNote(m, t, xfade);
      v.midi = m;
      v.nextChange = t + xfade + this.padInterval();
    }

    choosePadNote(v) {
      const lo = 50, hi = 75, center = 62;
      const others = this.voices.filter(o => o !== v).map(o => o.midi);
      const pairs = [];
      for (const m of this.scale.notesInRange(lo, hi)) {
        const step = Math.abs(m - v.midi);
        if (step === 0 || step > 5) continue;
        let w = 1 / step;
        let ok = true;
        for (const o of others) {
          const d = Math.abs(m - o);
          if (d === 0 || d === 1 || d === 13) { ok = false; break; }
          if (d === 2) w *= 0.35;
        }
        if (!ok) continue;
        const pc = this.scale.pcOf(m);
        if (pc === 1 || pc === 8) continue;       // semitone against root / fifth
        if (pc === 11) w *= 0.3;                  // major seventh: rare
        if (pc === 6) w *= 0.4;                   // tritone (Lydian): rare
        w *= Math.exp(-((m - center) ** 2) / (2 * 8 * 8));
        pairs.push([m, w]);
      }
      if (!pairs.length) return null;
      return this.rng.weighted(pairs);
    }

    startPadNote(midi, t, fadeIn) {
      const f = midiToHz(midi);
      const level = 0.1;
      const amp = this.gain(0);
      const lp = this.filter('lowpass', clamp(f * 3.2, 500, 4000), 0.6);
      const srcs = [];
      srcs.push(this.lfo(this.rng.range(0.015, 0.05), clamp(f * 3.2, 500, 4000) * 0.45, lp.frequency, t));
      const pan = this.panner(this.rng.range(-0.55, 0.55));
      srcs.push(this.lfo(this.rng.range(0.01, 0.03), 0.25, pan.pan, t));
      lp.connect(amp); amp.connect(pan); pan.connect(this.padTone);

      [['sawtooth', -6, 0.33], ['sawtooth', 6, 0.33], ['triangle', 0, 0.55]].forEach(([type, det, g]) => {
        const o = this.osc(type, f);
        o.detune.value = det + this.rng.range(-2, 2);
        if (type === 'sawtooth') srcs.push(this.lfo(this.rng.range(0.07, 0.13), 4, o.detune, t));
        const og = this.gain(g);
        o.connect(og); og.connect(lp);
        srcs.push(this.src(o, t));
      });

      // Halo: octave + twelfth, only into the hall
      const haloAmp = this.gain(0);
      const haloMod = this.gain(0.6);
      srcs.push(this.lfo(this.rng.range(0.02, 0.06), 0.4, haloMod.gain, t));
      haloMod.connect(haloAmp); haloAmp.connect(this.layer('pad', 'halo'));
      [[2, 0.012], [3, 0.005]].forEach(([r, g]) => {
        const o = this.osc('sine', f * r);
        const og = this.gain(g);
        o.connect(og); og.connect(haloMod);
        srcs.push(this.src(o, t));
      });

      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + fadeIn);
      haloAmp.gain.setValueAtTime(0, t);
      haloAmp.gain.linearRampToValueAtTime(1, t + fadeIn * 1.3);
      return { amp, haloAmp, level, srcs };
    }

    endPadNote(h, t, fade) {
      for (const [g, v] of [[h.amp.gain, h.level], [h.haloAmp.gain, 1]]) {
        g.cancelScheduledValues(t);
        g.setValueAtTime(v, t);
        g.linearRampToValueAtTime(0, t + fade);
      }
      for (const s of h.srcs) s.stop(t + fade + 0.1);
    }

    /* ── Motifs ─────────────────────────────────────────────────────── */

    newMotif() {
      const sc = this.scale, n = sc.n, rng = this.rng;
      const len = rng.int(3, 6);
      const startPool = [[0, 3], [n, 1]];
      if (sc.fifthIdx >= 0) startPool.push([sc.fifthIdx, 2]);
      if (sc.thirdIdx >= 0) startPool.push([sc.thirdIdx, 2]);
      const degs = [rng.weighted(startPool)];
      let last = 0;
      for (let i = 1; i < len; i++) {
        let step;
        if (Math.abs(last) >= 3) step = -Math.sign(last) * rng.int(1, 2);
        else step = rng.weighted([[-1, 3], [1, 3], [-2, 1.2], [2, 1.2], [-3, 0.4], [3, 0.4], [4, 0.2], [0, 0.6]]);
        degs.push(degs[i - 1] + step);
        last = step;
      }
      degs[len - 1] = sc.snapStable(degs[len - 1]);
      const durs = degs.map(() => rng.pick([1, 1, 1, 1.5, 0.75, 2]));
      durs[len - 1] = rng.range(2.2, 3.5);
      return { degs, durs };
    }

    varyMotif(m) {
      const rng = this.rng, sc = this.scale;
      let degs = m.degs.slice(), durs = m.durs.slice();
      const op = rng.pick(['transpose', 'tail', 'augment', 'truncate', 'invert']);
      if (op === 'transpose') {
        const s = rng.pick([-2, -1, 1, 2]);
        degs = degs.map(d => d + s);
      } else if (op === 'tail') {
        const k = Math.max(1, degs.length - rng.int(1, 2));
        for (let i = k; i < degs.length; i++) degs[i] = degs[i - 1] + rng.pick([-2, -1, 1, 2]);
      } else if (op === 'augment') {
        durs = durs.map(d => d * 1.3);
      } else if (op === 'truncate' && degs.length > 3) {
        const k = rng.int(2, degs.length - 1);
        degs = degs.slice(0, k); durs = durs.slice(0, k);
        durs[k - 1] = rng.range(2.2, 3.2);
      } else if (op === 'invert') {
        const d0 = degs[0];
        degs = degs.map(d => d0 - (d - d0));
      }
      degs[degs.length - 1] = sc.snapStable(degs[degs.length - 1]);
      return { degs, durs };
    }

    getMotif() {
      let m;
      if (this.motifs.length && this.rng.chance(0.5)) m = this.varyMotif(this.rng.pick(this.motifs));
      else m = this.newMotif();
      this.motifs.push(m);
      if (this.motifs.length > 4) this.motifs.shift();
      return m;
    }

    /* ── Lead instruments ───────────────────────────────────────────── */

    instruments() {
      const pc = this.cfg.rootPc;
      let fluteRoot = 60 + pc; if (fluteRoot < 62) fluteRoot += 12;      // D4 … C#5
      let shakRoot = fluteRoot - 12; if (shakRoot < 55) shakRoot += 12;
      const handRoot = 50 + mod(pc - 2, 12);                              // D3 … C#4
      return {
        bansuri:    { layer: 'flute',   base: fluteRoot, lo: 60, hi: 88, breath: 0.22, scoop: 0.15, tempo: 1.0,  vib: 0.006, cutoff: 3400, weight: 0.45 },
        shakuhachi: { layer: 'flute',   base: shakRoot,  lo: 55, hi: 81, breath: 0.55, scoop: 0.55, tempo: 1.25, vib: 0.004, cutoff: 2500, weight: 0.25 },
        handpan:    { layer: 'handpan', base: handRoot,  lo: 50, hi: 77, tempo: 0.7, weight: 0.30 },
      };
    }

    motifToMidi(motif, spec) {
      let midis = motif.degs.map(d => this.scale.midi(d, spec.base));
      if (Math.max(...midis) > spec.hi) midis = midis.map(m => m - 12);
      if (Math.min(...midis) < spec.lo) midis = midis.map(m => m + 12);
      return midis;
    }

    phraseEvent(t) {
      const ts = this.sessionTime(t);
      if (this.finite && ts > this.cfg.duration - 35) return Infinity;
      const inst = this.instruments();
      const avail = Object.keys(inst).filter(k => !this.muted(inst[k].layer));
      if (!avail.length) return t + 5;

      const a = arcAt(ts, this.cfg.duration);
      const name = this.rng.weighted(avail.map(k => [k, inst[k].weight]));
      const plane = a.phase === 'Stillness'
        ? this.rng.weighted([['mid', 0.4], ['far', 0.6]])
        : this.rng.weighted([['near', 0.3], ['mid', 0.45], ['far', 0.25]]);
      const pan = this.rng.range(-0.65, 0.65);
      const motif = this.getMotif();
      let end = this.playPhrase(name, inst[name], motif, t, plane, pan);

      // Call & response
      const others = avail.filter(k => k !== name);
      if (others.length && this.rng.chance(0.35)) {
        const name2 = this.rng.pick(others);
        const t2 = end + this.rng.range(1.2, 3.5);
        end = this.playPhrase(name2, inst[name2], this.varyMotif(motif), t2,
          plane === 'near' ? 'mid' : 'far', -pan * 0.8);
      }
      const dEff = this.effDensity();
      if (dEff < 0.03) return end + 20;
      const gap = (30 / (0.4 + 2 * dEff)) * this.rng.range(0.6, 1.6);
      return end + gap;
    }

    playPhrase(name, spec, motif, t, plane, pan) {
      const midis = this.motifToMidi(motif, spec);
      if (name === 'handpan') return this.playHandpan(spec, midis, motif.durs, t, plane, pan);
      return this.playFlute(spec, midis, motif.durs, t, plane, pan);
    }

    /* Flute: one legato voice per phrase. Sine/triangle core, band-passed
       breath noise that follows the pitch, onset "chiff", delayed vibrato,
       glides between notes, optional scoops (shakuhachi style). */
    playFlute(spec, midis, durs, t, plane, pan) {
      const rng = this.rng;
      const beat = rng.range(0.85, 1.35) * spec.tempo;
      const notes = [];
      let s = t;
      for (let i = 0; i < midis.length; i++) {
        const d = Math.max(0.7, durs[i] * beat * rng.range(0.85, 1.2));
        notes.push({ f: midiToHz(midis[i]), s, d, sl: i ? rng.range(0.07, 0.18) : 0, lvl: rng.range(0.75, 1.0) });
        s += d;
      }
      const tEnd = s;
      const release = rng.range(1.0, 1.8);
      const stopT = tEnd + release * 1.5 + 0.2;

      const out = this.layer(spec.layer, plane);
      const p = this.panner(pan);
      const tone = this.filter('lowpass', spec.cutoff, 0.5);
      const amp = this.gain(0);
      tone.connect(amp); amp.connect(p); p.connect(out);

      // Pitch control shared by all partials and the breath filter
      const fc = this.ctx.createConstantSource();
      fc.offset.value = notes[0].f;
      const core = [['sine', 1, 1.0], ['triangle', 1, 0.18], ['sine', 2, 0.08]];
      for (const [type, mult, g] of core) {
        const o = this.osc(type, 0);
        if (mult === 1) fc.connect(o.frequency);
        else { const m = this.gain(mult); fc.connect(m); m.connect(o.frequency); }
        const og = this.gain(g);
        o.connect(og); og.connect(tone);
        this.src(o, t, stopT);
      }
      // Vibrato
      const vib = this.osc('sine', rng.range(4.6, 5.4));
      const vibDepth = this.gain(0);
      vib.connect(vibDepth); vibDepth.connect(fc.offset);
      this.src(vib, t, stopT);
      // Breath noise: pitched band + air
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.whiteNoise; noise.loop = true;
      const bp = this.filter('bandpass', 0, 5);
      fc.connect(bp.frequency);
      const breath = this.gain(spec.breath * 0.9);
      noise.connect(bp); bp.connect(breath); breath.connect(tone);
      const hp = this.filter('highpass', 4000, 0.5);
      const airBase = spec.breath * 0.12;
      const air = this.gain(airBase);
      noise.connect(hp); hp.connect(air); air.connect(amp);
      this.sources.add(noise);
      noise.onended = () => this.sources.delete(noise);
      noise.start(t, rng.range(0, 3));
      noise.stop(stopT);
      this.src(fc, t, stopT);

      // Automation
      const peak = 0.16;
      const F = fc.offset, A = amp.gain, V = vibDepth.gain, R = air.gain;
      const first = notes[0];
      if (rng.chance(spec.scoop)) {
        F.setValueAtTime(first.f * 0.955, t);
        F.exponentialRampToValueAtTime(first.f, t + 0.3);
      } else {
        F.setValueAtTime(first.f, t);
      }
      A.setValueAtTime(0, t);
      A.linearRampToValueAtTime(peak * first.lvl, t + (spec.breath > 0.4 ? 0.28 : 0.18));
      R.setValueAtTime(airBase, t);

      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const nx = notes[i + 1];
        const L = peak * n.lvl;
        const S = L * rng.range(0.8, 1.15);
        if (i > 0) {
          const pv = notes[i - 1];
          const S0 = peak * pv.swell;
          const a0 = n.s - n.sl;
          // Pitch glide (optionally a scoop from below)
          F.setValueAtTime(pv.f, a0);
          if (rng.chance(spec.scoop * 0.6)) {
            F.exponentialRampToValueAtTime(n.f * 0.965, n.s);
            F.exponentialRampToValueAtTime(n.f, n.s + 0.25);
          } else {
            F.exponentialRampToValueAtTime(n.f, n.s);
          }
          // Small amplitude dip = articulation
          A.linearRampToValueAtTime(S0 * 0.72, n.s - n.sl / 2);
          A.linearRampToValueAtTime(L, n.s + 0.1);
          // Chiff
          R.setValueAtTime(airBase, n.s - 0.01);
          R.linearRampToValueAtTime(airBase * 4, n.s + 0.02);
          R.setTargetAtTime(airBase, n.s + 0.03, 0.06);
        }
        n.swell = S / peak;
        // Swell over the note body
        const bodyEnd = nx ? nx.s - nx.sl : tEnd;
        A.linearRampToValueAtTime(S, bodyEnd);
        // Delayed vibrato
        V.setValueAtTime(0, n.s);
        V.setTargetAtTime(n.f * spec.vib, n.s + 0.35, 0.3);
      }
      A.setTargetAtTime(0, tEnd, release / 4);
      F.setValueAtTime(notes[notes.length - 1].f, tEnd);
      F.exponentialRampToValueAtTime(notes[notes.length - 1].f * 0.988, tEnd + release);
      return tEnd + release * 0.5;
    }

    playHandpan(spec, midis, durs, t, plane, pan) {
      const rng = this.rng;
      const beat = rng.range(0.55, 0.9);
      let tn = t;
      for (let i = 0; i < midis.length; i++) {
        const vel = rng.range(0.6, 1.0) * (i === 0 ? 1 : 0.85);
        this.handpanNote(midiToHz(midis[i]), tn, vel, plane, clamp(pan + rng.range(-0.15, 0.15), -1, 1));
        tn += durs[i] * beat * rng.range(0.8, 1.3);
      }
      return tn + 2;
    }

    handpanNote(f, t, vel, plane, pan) {
      const sum = this.gain(1);
      const lp = this.filter('lowpass', 2600, 0.5);
      const p = this.panner(pan);
      sum.connect(lp); lp.connect(p); p.connect(this.layer('handpan', plane));
      const partials = [[1, 1, 4.5], [1.003, 0.35, 4.0], [2, 0.5, 2.6], [3, 0.18, 1.3]];
      for (const [r, a, d] of partials) {
        const o = this.osc('sine', f * r);
        const g = this.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a * vel * 0.2, t + (r > 1.01 ? 0.006 : 0.004));
        g.gain.setTargetAtTime(0, t + 0.008, d / 6.9);
        o.connect(g); g.connect(sum);
        this.src(o, t, t + d + 0.1);
      }
      this.noiseClick(t, 1200, 'lowpass', 0.04 * vel, sum);
    }

    noiseClick(t, freq, type, level, target) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.whiteNoise;
      const f = this.filter(type, freq, 0.8);
      const g = this.gain(0);
      g.gain.setValueAtTime(level, t);
      g.gain.setTargetAtTime(0, t + 0.002, 0.008);
      n.connect(f); f.connect(g); g.connect(target);
      this.sources.add(n);
      n.onended = () => this.sources.delete(n);
      n.start(t, this.rng.range(0, 3));
      n.stop(t + 0.06);
    }

    /* ── Singing bowls ──────────────────────────────────────────────── */

    bowlNote(root) {
      const base = 55 + mod(this.cfg.rootPc - 7, 12); // G3 … F#4
      if (root) return midiToHz(base);
      const fifth = base + 7 > 69 ? base - 5 : base + 7;
      return midiToHz(this.rng.weighted([[base, 3], [fifth, 2], [base + 12, 1]]));
    }

    bowlEvent(t) {
      const ts = this.sessionTime(t);
      if (this.finite && ts > this.cfg.duration - 50) return Infinity;
      if (this.muted('bowl')) return t + 10;
      const first = ts < 3;
      this.strikeBowl(this.bowlNote(first), t, !first && this.rng.chance(0.2), first ? 1 : this.rng.range(0.6, 1),
        first ? 'mid' : this.rng.pick(['mid', 'far', 'mid']), first ? 0 : this.rng.range(-0.5, 0.5));
      const gap = (80 / (0.5 + 1.5 * this.effDensity())) * this.rng.range(0.6, 1.5);
      return t + gap;
    }

    strikeBowl(f, t, rubbed, vel, plane, pan) {
      const ratios = [1, 2.71, 5.15, 8.3, 12.1];
      const amps = [1, 0.5, 0.28, 0.12, 0.05];
      const t60 = [30, 18, 10, 6, 3.5];
      const sum = this.gain(1);
      const p = this.panner(pan);
      sum.connect(p); p.connect(this.layer('bowl', plane));
      const swell = rubbed ? this.rng.range(4, 6) : 0;
      for (let k = 0; k < ratios.length; k++) {
        const fk = f * ratios[k];
        if (fk > 12000) continue;
        const env = this.gain(0);
        env.connect(sum);
        const beatHz = this.rng.range(0.4, 1.2) * (1 + k * 0.6);
        for (const ff of [fk, fk + beatHz]) {
          const o = this.osc('sine', ff);
          const g = this.gain(0.5);
          o.connect(g); g.connect(env);
          this.src(o, t, t + t60[k] + swell + 0.5);
        }
        const peak = amps[k] * vel * (rubbed ? 0.2 * (k ? 0.6 : 1) : 0.25);
        env.gain.setValueAtTime(0, t);
        if (rubbed) {
          env.gain.linearRampToValueAtTime(peak, t + swell);
          env.gain.setTargetAtTime(0, t + swell + 2, t60[k] / 6.9);
        } else {
          env.gain.linearRampToValueAtTime(peak, t + (k === 0 ? 0.012 : 0.003));
          env.gain.setTargetAtTime(0, t + 0.015, t60[k] / 6.9);
        }
      }
      if (!rubbed) this.noiseClick(t, 3000, 'bandpass', 0.05 * vel, sum);
    }

    /* ── Tanpura ────────────────────────────────────────────────────── */

    tanpuraEvent(t) {
      const ts = this.sessionTime(t);
      if (this.finite && ts > this.cfg.duration - 20) return Infinity;
      if (this.muted('tanpura')) return t + 3;
      const root = 43 + mod(this.cfg.rootPc - 7, 12); // G2 … F#3
      const strings = [root - 5, root, root, root - 12];
      const pans = [-0.4, -0.1, 0.1, 0.4];
      const i = this.tanIdx % 4;
      this.pluckTanpura(midiToHz(strings[i]), t, pans[i]);
      this.tanIdx++;
      return t + this.rng.range(1.2, 1.9) * (i === 3 ? 1.6 : 1);
    }

    pluckTanpura(f, t, pan) {
      const sum = this.gain(0);
      const p = this.panner(pan);
      sum.connect(p); p.connect(this.layer('tanpura', 'mid'));
      // Jawari: a resonant band sweeping down through the harmonics
      const bp = this.filter('bandpass', Math.min(f * 12, 8000), 3);
      bp.frequency.setValueAtTime(Math.min(f * 12, 8000), t);
      bp.frequency.exponentialRampToValueAtTime(f * 3, t + 3);
      const body = this.filter('lowpass', 900, 0.5);
      const bpg = this.gain(0.7), bodyg = this.gain(0.5);
      for (const det of [-3, 3]) {
        const o = this.osc('sawtooth', f);
        o.detune.value = det;
        o.connect(bp); o.connect(body);
        this.src(o, t, t + 8);
      }
      bp.connect(bpg); bpg.connect(sum);
      body.connect(bodyg); bodyg.connect(sum);
      sum.gain.setValueAtTime(0, t);
      sum.gain.linearRampToValueAtTime(0.2, t + 0.01);
      sum.gain.setTargetAtTime(0, t + 0.01, 1.4);
    }

    /* ── Ocean (irregular swells) ───────────────────────────────────── */

    startOcean(t) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.pinkNoise; n.loop = true;
      this.oceanBp = this.filter('bandpass', 160, 0.9);
      const lp = this.filter('lowpass', 1200, 0.5);
      this.oceanAmp = this.gain(0);
      const p = this.panner(0);
      this.lfo(0.013, 0.4, p.pan, t);
      n.connect(this.oceanBp); this.oceanBp.connect(lp); lp.connect(this.oceanAmp);
      this.oceanAmp.connect(p); p.connect(this.layer('ocean', 'mid'));
      this.src(n, t);
      this.next.wave = t + 0.5;
    }

    waveEvent(t) {
      const len = this.rng.range(7, 15);
      const peak = this.rng.range(0.45, 1.0) * 1.6;
      const A = this.oceanAmp.gain, F = this.oceanBp.frequency;
      A.setTargetAtTime(peak, t, len * 0.18);
      A.setTargetAtTime(0.2, t + len * 0.45, len * 0.2);
      F.setTargetAtTime(this.rng.range(450, 900), t, len * 0.2);
      F.setTargetAtTime(160, t + len * 0.45, len * 0.25);
      return t + len * this.rng.range(0.85, 1.1);
    }

    /* ── Binaural ───────────────────────────────────────────────────── */

    startBinaural(t) {
      this.binCarrier = midiToHz(48 + this.cfg.rootPc);
      const out = this.layer('binaural', 'dry');
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 8);
      g.connect(out);
      const l = this.osc('sine', this.binCarrier);
      const r = this.osc('sine', this.binCarrier + this.cfg.beat);
      const pl = this.panner(-1), pr = this.panner(1);
      l.connect(pl); r.connect(pr); pl.connect(g); pr.connect(g);
      this.src(l, t); this.src(r, t);
      this.binR = r;
    }
  }

  /* ── Offline rendering + WAV export ─────────────────────────────── */

  async function renderOffline(cfg, seconds, OfflineCtx, sampleRate) {
    OfflineCtx = OfflineCtx || root.OfflineAudioContext || root.webkitOfflineAudioContext;
    sampleRate = sampleRate || 44100;
    const ctx = new OfflineCtx(2, Math.ceil(seconds * sampleRate), sampleRate);
    const out = createOutput(ctx, false);
    const eng = new Engine(ctx, out.input, Object.assign({}, cfg, { duration: seconds, offset: 0 }));
    eng.start(0);
    eng.advance(seconds + 1);
    return ctx.startRendering();
  }

  // AudioBuffer → 16-bit PCM WAV (ArrayBuffer), with TPDF dither
  function encodeWav(buffer) {
    const chs = Math.min(2, buffer.numberOfChannels);
    const len = buffer.length, sr = buffer.sampleRate;
    const data = [];
    for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
    const bytes = 44 + len * chs * 2;
    const ab = new ArrayBuffer(bytes);
    const v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chs, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * chs * 2, true); v.setUint16(32, chs * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len * chs * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < chs; c++) {
        const dither = (Math.random() - Math.random()) / 32768;
        const s = clamp(data[c][i] + dither, -1, 1);
        v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
        o += 2;
      }
    }
    return ab;
  }

  root.MediToneEngine = {
    Engine, createOutput, renderOffline, encodeWav, arcAt,
    MODES, ROOTS, LAYERS, DEFAULT_LEVELS, MUTE_DB, dbToGain,
  };
})(typeof window !== 'undefined' ? window : globalThis);
