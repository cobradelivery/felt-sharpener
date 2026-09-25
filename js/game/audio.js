/* All audio is synthesized with WebAudio — no files, works offline.
   - Music: a small generative jazz-lounge band (walking bass, brushes, e-piano comping, vibes melody)
     rotating through three tunes. Heads repeat so they're hummable; solos vary each chorus.
   - SFX: card deals/flips, riffle shuffles, clay-chip clacks, knuckle checks, UI blips.
   - Vox: formant-synth babble (grumbles, cheers, laughs, "hmm"s, crowd "ooh") per character voice. */
(function (root) {
  'use strict';
  const FS = root.FS;

  let ctx = null, master, musicBus, sfxBus, voxBus, reverb, reverbSend, noiseBuf;
  const settings = { music: 0.5, sfx: 0.8, vox: 0.7, muted: false };

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    voxBus = ctx.createGain(); voxBus.connect(comp);
    reverb = ctx.createConvolver(); reverb.buffer = makeIR(1.8); reverb.connect(comp);
    reverbSend = ctx.createGain(); reverbSend.gain.value = 0.22; reverbSend.connect(reverb);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    return true;
  }
  function makeIR(sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return b;
  }
  function applyVolumes() {
    if (!ctx) return;
    const m = settings.muted ? 0 : 1;
    master.gain.setTargetAtTime(m, ctx.currentTime, 0.05);
    musicBus.gain.setTargetAtTime(settings.music * 0.55, ctx.currentTime, 0.1);
    sfxBus.gain.setTargetAtTime(settings.sfx, ctx.currentTime, 0.05);
    voxBus.gain.setTargetAtTime(settings.vox * 0.9, ctx.currentTime, 0.05);
  }
  function setVolumes(v) { Object.assign(settings, v); applyVolumes(); }

  // ---------- primitives ----------
  function env(g, t, a, peak, decay, sustain, release, hold) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(sustain * peak, t + a, decay);
    if (hold != null) g.gain.setTargetAtTime(0.0001, t + a + hold, release);
  }
  function noise(t, dur, out) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(t + dur);
    s.connect(out);
    return s;
  }
  function osc(type, f, t, dur, out) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    o.connect(out); o.start(t); o.stop(t + dur);
    return o;
  }
  function gainNode(v, out) { const g = ctx.createGain(); g.gain.value = v; if (out) g.connect(out); return g; }
  function filter(type, f, q, out) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; if (out) b.connect(out); return b; }
  function panner(p, out) { if (!ctx.createStereoPanner) return out; const s = ctx.createStereoPanner(); s.pan.value = p; s.connect(out); return s; }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- instruments ----------
  function epiano(t, midi, dur, vel, pan) {
    const out = panner(pan || 0, musicBus);
    const g = gainNode(0, out);
    const f = mtof(midi);
    const car = osc('sine', f, t, dur + 1.2, g);
    const mod = ctx.createOscillator(); mod.frequency.value = f * 1.0;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6 * vel, t); mg.gain.setTargetAtTime(f * 0.2, t, 0.12);
    mod.connect(mg); mg.connect(car.frequency); mod.start(t); mod.stop(t + dur + 1.2);
    const bell = osc('sine', f * 4.01, t, 0.4, gainNode(0.04 * vel, g));
    void bell;
    env(g, t, 0.006, 0.09 * vel, 0.5, 0.35, 0.18, dur);
    g.connect(reverbSend);
  }
  function vibes(t, midi, dur, vel) {
    const out = panner(0.25, musicBus);
    const g = gainNode(0, out);
    const f = mtof(midi);
    osc('sine', f, t, dur + 1.5, g);
    const p = gainNode(0.0, g); osc('sine', f * 4, t, 0.25, p);
    p.gain.setValueAtTime(0.35, t); p.gain.setTargetAtTime(0.0001, t, 0.03);
    // tremolo (motor)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
    const lg = ctx.createGain(); lg.gain.value = 0.03 * vel;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + dur + 1.5);
    env(g, t, 0.004, 0.12 * vel, 0.35, 0.4, 0.3, dur);
    const s = gainNode(1.4, reverbSend); g.connect(s);
  }
  function bass(t, midi, dur, vel) {
    const lp = filter('lowpass', 700, 1, musicBus);
    const g = gainNode(0, lp);
    const f = mtof(midi);
    osc('triangle', f, t, dur + 0.3, g);
    osc('sine', f, t, dur + 0.3, gainNode(0.6, g));
    env(g, t, 0.008, 0.28 * vel, 0.18, 0.55, 0.06, dur * 0.92);
  }
  function kick(t, vel) {
    const g = gainNode(0, musicBus);
    const o = osc('sine', 110, t, 0.3, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 0.003, 0.35 * vel, 0.07, 0.0, 0.05, 0.12);
  }
  function brush(t, vel, len) {
    const bp = filter('bandpass', 3800, 0.7, panner(-0.2, musicBus));
    const g = gainNode(0, bp);
    noise(t, (len || 0.12) + 0.2, g);
    env(g, t, len ? 0.05 : 0.003, 0.09 * vel, len ? len * 0.4 : 0.05, 0.0, 0.05, len || 0.05);
  }
  function ride(t, vel) {
    const hp = filter('highpass', 6500, 0.5, panner(0.3, musicBus));
    const g = gainNode(0, hp);
    noise(t, 0.5, g);
    [1, 1.47, 2.13].forEach((k) => osc('square', 3100 * k, t, 0.3, gainNode(0.02, g)));
    env(g, t, 0.002, 0.05 * vel, 0.16, 0.0, 0.1, 0.12);
    hp.connect(reverbSend);
  }
  function hat(t, vel) {
    const hp = filter('highpass', 8000, 0.6, panner(0.35, musicBus));
    const g = gainNode(0, hp);
    noise(t, 0.08, g);
    env(g, t, 0.001, 0.05 * vel, 0.015, 0, 0.01, 0.02);
  }
  function shaker(t, vel) {
    const bp = filter('bandpass', 6000, 1.2, panner(0.4, musicBus));
    const g = gainNode(0, bp);
    noise(t, 0.1, g);
    env(g, t, 0.01, 0.03 * vel, 0.02, 0, 0.02, 0.03);
  }

  // ---------- harmony ----------
  const QUAL = { maj7: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10, 14], '7': [0, 4, 7, 10, 14], m7b5: [0, 3, 6, 10], m6: [0, 3, 7, 9, 14], '6': [0, 4, 7, 9, 14], dim7: [0, 3, 6, 9] };
  const NOTE = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
  function parseChord(s) {
    const m = /^([A-G]b?)(.*)$/.exec(s);
    return { root: NOTE[m[1]], q: QUAL[m[2] || 'maj7'] || QUAL.maj7, name: s };
  }
  const SONGS = [
    { name: 'Felt Lounge', bpm: 118, swing: 0.64, feel: 'swing',
      A: 'Fmaj7 D7 Gm7 C7 Am7 D7 Gm7 C7 Fmaj7 D7 Gm7 C7 Am7 D7 Gm7 C7',
      B: 'Bbmaj7 Bbm6 Am7 D7 Gm7 C7 Am7 D7 Gm7 C7 Fmaj7 D7 Gm7 C7 Fmaj7 C7', form: 'AABA' },
    { name: 'Chip Shuffle', bpm: 128, swing: 0.5, feel: 'bossa',
      A: 'Cmaj7 Cmaj7 Am7 Am7 Dm7 G7 Cmaj7 A7 Dm7 Dm7 G7 G7 Em7 A7 Dm7 G7',
      B: 'Fmaj7 Fmaj7 Fm6 Fm6 Em7 A7 Dm7 G7 Em7 A7 Dm7 G7 Cmaj7 A7 Dm7 G7', form: 'AABA' },
    { name: 'River Card Strut', bpm: 138, swing: 0.66, feel: 'swing',
      A: 'Bb7 Eb7 Bb7 Bb7 Eb7 Eb7 Bb7 G7 Cm7 F7 Bb7 F7',
      B: 'Bb7 Eb7 Bb7 Bb7 Eb7 Edim7 Bb7 G7 Cm7 F7 Dm7 G7 Cm7 F7 Bb7 F7', form: 'AAB' },
  ];

  // melody from a seed: phrases of 2 bars, rhythm cells in eighths
  const RHYTHMS = [
    [0, 1, 2, 4, 6], [0, 3, 4, 5, 6], [1, 2, 3, 5], [0, 2, 3, 6, 7], [0, 4, 5, 7], [2, 3, 4, 6], [0, 1, 3, 4], [0, 6],
  ];
  function genMelody(chords, seed, density) {
    const rng = FS.util.makeRng(seed);
    const notes = []; // {bar, step, midi, len}
    let last = 72;
    let motif = null;
    for (let bar = 0; bar < chords.length; bar++) {
      const ch = chords[bar];
      const phrasePos = bar % 4;
      if (phrasePos === 3 && rng() < 0.7) { // breathe at phrase end: one long note
        const tones = ch.q.slice(0, 4).map((i) => 60 + ((ch.root + i) % 12));
        const n = nearest(tones, last); notes.push({ bar, step: 0, midi: n, len: 4 }); last = n; continue;
      }
      let rhythm;
      if (phrasePos === 0 || !motif) { rhythm = RHYTHMS[rng.int(RHYTHMS.length)]; motif = rhythm; }
      else rhythm = rng() < 0.55 ? motif : RHYTHMS[rng.int(RHYTHMS.length)];
      if (rng() > density) rhythm = rhythm.filter((_, i) => i % 2 === 0);
      const tones = []; for (let o = 0; o < 3; o++) for (const i of ch.q) tones.push(60 + ((ch.root + i) % 12) + 12 * (o - 1) + 12);
      let dir = rng() < 0.5 ? -1 : 1;
      rhythm.forEach((step, k) => {
        const strong = step % 2 === 0;
        let n;
        if (strong || rng() < 0.5) {
          const cands = tones.filter((x) => x >= 64 && x <= 86 && Math.sign(x - last) === dir && Math.abs(x - last) <= 7);
          n = cands.length ? cands[rng.int(cands.length)] : nearest(tones.filter((x) => x >= 64 && x <= 86), last);
        } else {
          n = last + dir * (rng() < 0.6 ? 2 : 1); // passing tone
        }
        if (n > 84) dir = -1; if (n < 66) dir = 1;
        if (rng() < 0.2) dir = -dir;
        const nextStep = rhythm[k + 1] != null ? rhythm[k + 1] : 8;
        notes.push({ bar, step, midi: n, len: Math.max(1, nextStep - step) });
        last = n;
      });
    }
    return notes;
  }
  function nearest(arr, x) { let b = arr[0]; for (const a of arr) if (Math.abs(a - x) < Math.abs(b - x)) b = a; return b; }

  // ---------- sequencer ----------
  const music = { playing: false, songIdx: 0, timer: null, nextTime: 0, step: 0, plan: null, chorus: 0, mood: 'normal' };
  function buildPlan(song, chorus) {
    const sections = song.form.split('');
    const bars = [];
    const melodies = {};
    for (const s of ['A', 'B']) {
      const chords = song[s].split(' ').map(parseChord);
      melodies[s] = { chords, head: genMelody(chords, FS.util.hashString(song.name + s), 0.8) };
    }
    const soloSeed = FS.util.hashString(song.name) + chorus * 977;
    sections.forEach((s, si) => {
      const { chords, head } = melodies[s];
      const isSolo = chorus % 2 === 1;
      const mel = isSolo ? genMelody(chords, soloSeed + si * 13, 0.95) : head;
      chords.forEach((ch, b) => bars.push({ chord: ch, next: chords[b + 1] || melodies[sections[(si + 1) % sections.length]].chords[0], mel: mel.filter((n) => n.bar === b), section: s, solo: isSolo }));
    });
    return bars;
  }

  function startMusic() {
    if (!init()) return;
    if (music.playing) return;
    music.playing = true;
    music.chorus = 0; music.step = 0;
    music.plan = buildPlan(SONGS[music.songIdx], 0);
    music.nextTime = ctx.currentTime + 0.1;
    music.timer = setInterval(schedule, 30);
  }
  function stopMusic() { music.playing = false; clearInterval(music.timer); music.timer = null; }
  function nextSong() { music.songIdx = (music.songIdx + 1) % SONGS.length; music.chorus = 0; music.step = 0; music.plan = buildPlan(SONGS[music.songIdx], 0); }
  function setMood(m) { music.mood = m; }

  function schedule() {
    if (!music.playing) return;
    const song = SONGS[music.songIdx];
    const tempo = song.bpm * (music.mood === 'tense' ? 1.06 : 1);
    const beat = 60 / tempo;
    while (music.nextTime < ctx.currentTime + 0.25) {
      const totalSteps = music.plan.length * 8;
      if (music.step >= totalSteps) {
        music.chorus++;
        music.step = 0;
        if (music.chorus >= 4) { nextSong(); return schedule(); }
        music.plan = buildPlan(song, music.chorus);
      }
      const barIdx = Math.floor(music.step / 8), s = music.step % 8;
      const bar = music.plan[barIdx];
      const eighth = beat / 2;
      const swingOff = s % 2 === 1 ? (song.swing - 0.5) * beat : 0;
      const t = music.nextTime + swingOff;
      playStep(song, bar, s, t, beat);
      music.nextTime += eighth;
      music.step++;
    }
  }

  function playStep(song, bar, s, t, beat) {
    const ch = bar.chord, root = 36 + ch.root;
    const h = FS.util.hashString(song.name + music.step + ':' + music.chorus);
    const r = (h % 1000) / 1000;
    // drums
    if (song.feel === 'swing') {
      if (s % 2 === 0) ride(t, s === 2 || s === 6 ? 1 : 0.8);
      if (s === 3 || s === 7) ride(t, 0.55);
      if (s === 2 || s === 6) hat(t, 0.9);
      if (s === 0) brush(t, 0.6, beat * 1.6);
      if (s === 4) brush(t, 0.6, beat * 1.6);
      if ((s === 5 || s === 3) && r < 0.3) brush(t, 0.35);
      if (s === 0 && r < 0.5) kick(t, 0.35);
      // walking bass: quarter notes
      if (s % 2 === 0) {
        const beatN = s / 2;
        let n;
        const tones = ch.q;
        if (beatN === 0) n = root;
        else if (beatN === 3) { const nr = 36 + bar.next.root; n = nr + (r < 0.5 ? -1 : 1); }
        else n = root + tones[(beatN + (r < 0.5 ? 1 : 0)) % Math.min(4, tones.length)];
        while (n > 52) n -= 12; while (n < 33) n += 12;
        bass(t, n, beat * 0.95, 0.9);
      }
      // comping: charleston + variations
      const comp = (s === 0 && r < 0.4) || s === 3 || (s === 6 && r > 0.6) || (s === 4 && r < 0.15);
      if (comp) voicing(ch).forEach((m, i) => epiano(t + i * 0.006, m, beat * (s === 3 ? 1.2 : 0.6), 0.75, -0.3 + i * 0.1));
    } else { // bossa
      shaker(t, s % 2 === 0 ? 1 : 0.6);
      if (s === 0 || s === 3 || s === 4 || s === 7) kick(t, s === 0 || s === 4 ? 0.4 : 0.25);
      if ([0, 3, 6].includes(s) || (s === 2 && music.step % 16 >= 8) || (s === 5 && music.step % 16 >= 8)) brush(t, 0.45);
      if (s === 0) bass(t, root, beat * 1.4, 0.95);
      if (s === 3) bass(t, root + 7 > 52 ? root - 5 : root + 7, beat * 0.5, 0.8);
      if (s === 4) bass(t, root + 7 > 52 ? root - 5 : root + 7, beat * 1.4, 0.85);
      if (s === 7) bass(t, root, beat * 0.5, 0.7);
      const pat = music.step % 16 < 8 ? [0, 3, 6] : [2, 5];
      if (pat.includes(s)) voicing(ch).forEach((m, i) => epiano(t + i * 0.005, m, beat * 0.45, 0.65, -0.3 + i * 0.1));
    }
    // melody
    for (const n of bar.mel) if (n.step === s) vibes(t, n.midi, n.len * beat / 2 * 0.95, bar.solo ? 0.8 : 1);
  }
  function voicing(ch) {
    // rootless-ish voicing around middle C: 3rd, 5th/6th, 7th, 9th
    const base = 52;
    const pcs = ch.q.length >= 5 ? [ch.q[1], ch.q[3], ch.q[4]] : [ch.q[1], ch.q[2], ch.q[3]];
    return pcs.map((i) => { let n = base + ((ch.root + i) % 12); if (n < 55) n += 12; return n; }).sort((a, b) => a - b);
  }

  // ---------- SFX ----------
  function now() { return ctx.currentTime; }
  const sfx = {
    deal(delay) {
      if (!init()) return; const t = now() + (delay || 0);
      const bp = filter('bandpass', 4500, 0.9, sfxBus);
      bp.frequency.setValueAtTime(5200, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.09);
      const g = gainNode(0, bp); noise(t, 0.2, g);
      env(g, t, 0.004, 0.55, 0.03, 0.0, 0.02, 0.06);
      const thump = gainNode(0, filter('lowpass', 400, 1, sfxBus)); noise(t + 0.07, 0.05, thump);
      env(thump, t + 0.07, 0.002, 0.4, 0.01, 0, 0.01, 0.02);
    },
    flip(delay) {
      if (!init()) return; const t = now() + (delay || 0);
      for (const [dt, f, v] of [[0, 3000, 0.45], [0.035, 1800, 0.5]]) {
        const bp = filter('bandpass', f, 1.5, sfxBus); const g = gainNode(0, bp); noise(t + dt, 0.05, g);
        env(g, t + dt, 0.001, v, 0.008, 0, 0.01, 0.01);
      }
    },
    shuffle() {
      if (!init()) return; const t = now();
      for (let i = 0; i < 44; i++) {
        const x = i / 44, dt = 0.75 * (x + 0.25 * Math.sin(x * Math.PI));
        const bp = filter('bandpass', 2500 + Math.random() * 2500, 2, sfxBus); const g = gainNode(0, bp);
        noise(t + dt, 0.03, g); env(g, t + dt, 0.001, 0.22 + Math.random() * 0.1, 0.004, 0, 0.004, 0.006);
      }
      const bp = filter('bandpass', 1500, 0.6, sfxBus); const g = gainNode(0, bp); noise(t + 0.8, 0.3, g);
      env(g, t + 0.8, 0.04, 0.25, 0.08, 0, 0.05, 0.12);
    },
    chip(count, delay, pan) {
      if (!init()) return; count = Math.max(1, Math.min(8, count || 1));
      const base = now() + (delay || 0);
      const out = panner(pan || 0, sfxBus);
      for (let i = 0; i < count; i++) {
        const t = base + i * (0.025 + Math.random() * 0.035);
        const g = gainNode(0, out);
        [2300, 3700, 5600].forEach((f, k) => {
          const bp = filter('bandpass', f * (0.95 + Math.random() * 0.1), 14, g);
          const s = noise(t, 0.08, gainNode(1.6 - k * 0.3, bp)); void s;
        });
        env(g, t, 0.0008, 0.9, 0.018, 0, 0.01, 0.03);
      }
    },
    chipsSlide(delay) {
      if (!init()) return; const t = now() + (delay || 0);
      const bp = filter('bandpass', 2200, 0.8, sfxBus); const g = gainNode(0, bp); noise(t, 0.4, g);
      env(g, t, 0.05, 0.22, 0.1, 0, 0.06, 0.18);
      sfx.chip(4, (delay || 0) + 0.18);
    },
    potWin() { if (!init()) return; sfx.chipsSlide(0); sfx.chip(6, 0.25); sfx.chip(5, 0.42); },
    check() {
      if (!init()) return; const t = now();
      for (const dt of [0, 0.11]) {
        const g = gainNode(0, sfxBus);
        const o = osc('sine', 190, t + dt, 0.1, g); o.frequency.exponentialRampToValueAtTime(90, t + dt + 0.06);
        const lp = filter('lowpass', 900, 1, g); const ng = gainNode(0.7, lp); void ng; noise(t + dt, 0.04, lp);
        env(g, t + dt, 0.001, 0.6, 0.02, 0, 0.02, 0.03);
      }
    },
    fold() {
      if (!init()) return; const t = now();
      const lp = filter('bandpass', 1800, 0.7, sfxBus); lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
      const g = gainNode(0, lp); noise(t, 0.3, g); env(g, t, 0.02, 0.3, 0.06, 0, 0.04, 0.12);
    },
    blip(pitch) {
      if (!init()) return; const t = now();
      const g = gainNode(0, sfxBus); g.connect(reverbSend);
      const o = osc('sine', pitch || 880, t, 0.15, g); o.frequency.exponentialRampToValueAtTime((pitch || 880) * 1.5, t + 0.05);
      env(g, t, 0.002, 0.12, 0.03, 0, 0.02, 0.05);
    },
    select() {
      if (!init()) return; const t = now();
      [[988, 0], [1318, 0.07]].forEach(([f, dt]) => { const g = gainNode(0, sfxBus); g.connect(reverbSend); osc('triangle', f, t + dt, 0.3, g); env(g, t + dt, 0.003, 0.14, 0.06, 0, 0.05, 0.1); });
    },
    back() {
      if (!init()) return; const t = now();
      [[660, 0], [440, 0.06]].forEach(([f, dt]) => { const g = gainNode(0, sfxBus); osc('triangle', f, t + dt, 0.2, g); env(g, t + dt, 0.003, 0.12, 0.04, 0, 0.04, 0.06); });
    },
    tick() { if (!init()) return; const t = now(); const g = gainNode(0, sfxBus); osc('square', 1800, t, 0.03, filter('lowpass', 3000, 1, g)); g.connect(sfxBus); env(g, t, 0.001, 0.05, 0.005, 0, 0.005, 0.01); },
    fanfare() {
      if (!init()) return; const t = now();
      [[72, 0], [76, 0.1], [79, 0.2], [84, 0.3]].forEach(([m, dt]) => { const g = gainNode(0, sfxBus); g.connect(reverbSend); osc('square', mtof(m), t + dt, 0.5, filter('lowpass', 2500, 1, g)); osc('triangle', mtof(m), t + dt, 0.5, g); env(g, t + dt, 0.005, 0.08, 0.15, 0.3, 0.1, dt === 0.3 ? 0.4 : 0.08); });
    },
    win() {
      if (!init()) return; const t = now();
      [[67, 0], [72, 0.09], [76, 0.18], [79, 0.27], [84, 0.36], [88, 0.45]].forEach(([m, dt]) => { const g = gainNode(0, sfxBus); g.connect(reverbSend); osc('triangle', mtof(m), t + dt, 0.6, g); env(g, t + dt, 0.004, 0.1, 0.2, 0.2, 0.15, 0.2); });
    },
    sting() {
      if (!init()) return; const t = now();
      [[62, 0], [61, 0.25], [60, 0.5], [59, 0.75]].forEach(([m, dt]) => { const g = gainNode(0, sfxBus); g.connect(reverbSend); osc('sawtooth', mtof(m - 12), t + dt, 0.5, filter('lowpass', 900, 1, g)); env(g, t + dt, 0.01, 0.1, 0.15, 0.4, 0.1, dt === 0.75 ? 0.7 : 0.2); });
    },
  };

  // ---------- Vox: formant babble ----------
  const VOWELS = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [300, 2200, 2900], o: [570, 840, 2410], u: [320, 870, 2240], m: [260, 1100, 2300], r: [490, 1350, 1690], h: [600, 1300, 2500] };
  function voice(t, v, plan, out) {
    // plan: array of {vowel, dur, p0, p1, amp, breath}
    const fem = v.timbre === 'f';
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = v.pitch * 0.015; vib.connect(vg); vg.connect(src.frequency);
    const amp = ctx.createGain(); amp.gain.value = 0.0001;
    const fs = [0, 1, 2].map((k) => { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.Q.value = [6, 9, 11][k]; const g = gainNode([1, 0.55, 0.25][k], amp); b.connect(g); src.connect(b); return b; });
    const br = ctx.createGain(); br.gain.value = 0.0001; const brf = filter('bandpass', 1500, 0.8, br);
    br.connect(amp);
    const nsrc = noise(t, plan.reduce((a, s) => a + s.dur, 0) + 0.3, brf); void nsrc;
    amp.connect(out);
    let tt = t;
    const fk = fem ? 1.17 : 1;
    for (const s of plan) {
      const F = VOWELS[s.vowel] || VOWELS.a;
      fs.forEach((b, k) => b.frequency.setTargetAtTime(F[k] * fk, tt, 0.025));
      src.frequency.setValueAtTime(v.pitch * s.p0, tt);
      src.frequency.linearRampToValueAtTime(v.pitch * s.p1, tt + s.dur);
      const a = s.amp == null ? 1 : s.amp;
      amp.gain.setTargetAtTime(1.5 * a, tt, 0.02);
      amp.gain.setTargetAtTime(0.2 * a, tt + s.dur * 0.75, 0.03);
      br.gain.setTargetAtTime(s.breath || 0.05, tt, 0.02);
      tt += s.dur;
    }
    amp.gain.setTargetAtTime(0.0001, tt, 0.04);
    src.start(t); src.stop(tt + 0.3); vib.start(t); vib.stop(tt + 0.3);
    return tt - t;
  }
  function randVowel(rng, set) { return set[Math.floor(rng() * set.length)]; }
  const vox = {
    say(kind, v, pan) {
      if (!init()) return 0;
      v = v || { pitch: 130, timbre: 'm' };
      const rng = Math.random;
      const out = panner(pan || 0, voxBus);
      const t = now() + 0.02;
      let plan = [];
      switch (kind) {
        case 'grumble': {
          const n = 2 + Math.floor(rng() * 3);
          plan.push({ vowel: 'm', dur: 0.12, p0: 0.85, p1: 0.8, amp: 0.6 });
          for (let i = 0; i < n; i++) plan.push({ vowel: randVowel(rng, ['o', 'u', 'r', 'a']), dur: 0.1 + rng() * 0.08, p0: 0.8 - i * 0.05, p1: 0.72 - i * 0.05, amp: 0.8 });
          plan.push({ vowel: 'r', dur: 0.22, p0: 0.7, p1: 0.55, amp: 0.6, breath: 0.1 });
          break;
        }
        case 'cheer':
          plan = [{ vowel: 'i', dur: 0.08, p0: 1.3, p1: 1.4 }, { vowel: 'e', dur: 0.12, p0: 1.45, p1: 1.7 }, { vowel: 'a', dur: 0.3, p0: 1.75, p1: 1.55, amp: 1.2 }];
          if (rng() < 0.5) plan.push({ vowel: 'h', dur: 0.05, p0: 1.5, p1: 1.5, amp: 0.2, breath: 0.4 }, { vowel: 'a', dur: 0.22, p0: 1.7, p1: 1.4 });
          break;
        case 'laugh':
          for (let i = 0; i < 4; i++) plan.push({ vowel: 'h', dur: 0.05, p0: 1.3, p1: 1.3, amp: 0.15, breath: 0.5 }, { vowel: 'a', dur: 0.09, p0: 1.35 - i * 0.05, p1: 1.25 - i * 0.05 });
          break;
        case 'hmm':
          plan = [{ vowel: 'm', dur: 0.25, p0: 1.0, p1: 1.12, amp: 0.7 }, { vowel: 'm', dur: 0.3, p0: 1.12, p1: 0.9, amp: 0.6 }];
          break;
        case 'gasp':
          plan = [{ vowel: 'h', dur: 0.12, p0: 1.4, p1: 1.4, amp: 0.1, breath: 0.6 }, { vowel: 'o', dur: 0.18, p0: 1.5, p1: 1.3, amp: 0.8 }];
          break;
        case 'groan':
          plan = [{ vowel: 'u', dur: 0.2, p0: 1.0, p1: 0.95 }, { vowel: 'o', dur: 0.35, p0: 0.95, p1: 0.6, amp: 0.9 }, { vowel: 'r', dur: 0.15, p0: 0.6, p1: 0.5, amp: 0.4, breath: 0.2 }];
          break;
        default: { // 'talk' babble
          const n = 3 + Math.floor(rng() * 4);
          for (let i = 0; i < n; i++) {
            const p = 1 + (rng() - 0.5) * 0.3 - (i === n - 1 ? 0.12 : 0);
            if (rng() < 0.4) plan.push({ vowel: 'm', dur: 0.04, p0: p, p1: p, amp: 0.4 });
            plan.push({ vowel: randVowel(rng, ['a', 'e', 'i', 'o', 'u']), dur: 0.07 + rng() * 0.07, p0: p, p1: p * (0.95 + rng() * 0.1) });
          }
        }
      }
      return voice(t, v, plan, out);
    },
    crowd(kind) {
      if (!init()) return;
      const pitches = [110, 125, 150, 200, 220, 95];
      pitches.forEach((p, i) => {
        const v = { pitch: p * (0.95 + Math.random() * 0.1), timbre: p > 180 ? 'f' : 'm' };
        const out = panner(-0.6 + i * 0.24, gainNode(0.5, voxBus));
        const t = now() + Math.random() * 0.12;
        const plan = kind === 'ooh'
          ? [{ vowel: 'u', dur: 0.25, p0: 1.1, p1: 1.35 }, { vowel: 'o', dur: 0.45, p0: 1.35, p1: 1.0, amp: 0.8 }]
          : [{ vowel: 'e', dur: 0.1, p0: 1.3, p1: 1.5 }, { vowel: 'a', dur: 0.4, p0: 1.5, p1: 1.3 }];
        voice(t, v, plan, out);
      });
    },
  };

  /** Analyser on the master output (used by tests / level checks). */
  function tap() { if (!init()) return null; const a = ctx.createAnalyser(); a.fftSize = 2048; master.connect(a); return a; }

  FS.audio = { init, tap, setVolumes, settings, startMusic, stopMusic, nextSong, setMood, sfx, vox, SONGS, get playing() { return music.playing; }, get songName() { return SONGS[music.songIdx].name; } };
})(typeof window !== 'undefined' ? window : globalThis);
