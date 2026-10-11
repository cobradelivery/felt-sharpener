/* Scorched — sound effects, synthesised with Web Audio (no audio files).
   The context is created on the first user gesture, as browsers require. */
(function (root) {
  'use strict';
  const SE = root.SE || (root.SE = {});

  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('scorched.muted') === '1'; } catch (e) { /* storage blocked */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  function noise(dur, freq, q, peak, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
    return f;
  }

  function tone(type, f0, f1, dur, peak, delay) {
    if (!ctx) return;
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  const sfx = {
    fire() { tone('square', 220, 60, 0.18, 0.25); noise(0.25, 1800, 0.8, 0.35); },
    boom(r) {
      const size = Math.min(1, (r || 20) / 85);
      const f = noise(0.4 + size * 1.6, 500 + 900 * (1 - size), 0.5, 0.5 + size * 0.5);
      if (f) f.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.4 + size * 1.6);
      tone('sine', 90 - size * 40, 30, 0.3 + size, 0.5 + size * 0.4);
    },
    dirt() { noise(0.35, 300, 0.6, 0.5); },
    fizzle() { noise(0.15, 3000, 1, 0.15, 'highpass'); },
    split() { tone('triangle', 900, 1400, 0.12, 0.15); },
    napalm() { noise(1.2, 900, 0.4, 0.35, 'bandpass'); },
    dig() { tone('sawtooth', 70, 50, 0.6, 0.15); },
    hit() { tone('square', 160, 80, 0.08, 0.12); },
    death() { tone('sawtooth', 300, 40, 0.9, 0.3); noise(1.6, 400, 0.5, 0.8); },
    turn() { tone('triangle', 660, 660, 0.07, 0.12); tone('triangle', 880, 880, 0.09, 0.12, 0.08); },
    click() { tone('square', 1200, 1200, 0.025, 0.06); },
    buy() { tone('square', 988, 988, 0.06, 0.1); tone('square', 1319, 1319, 0.12, 0.1, 0.06); },
    deny() { tone('square', 140, 120, 0.15, 0.12); },
    shield() { tone('sine', 300, 1200, 0.35, 0.2); },
    chute() { noise(0.3, 1200, 0.5, 0.2, 'bandpass'); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.15, i * 0.12)); },
  };

  function play(name, arg) { try { if (ctx && !muted && sfx[name]) sfx[name](arg); } catch (e) { /* ignore audio glitches */ } }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('scorched.muted', muted ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (master) master.gain.value = muted ? 0 : 0.5;
  }

  SE.audio = { init, play, setMuted, isMuted: () => muted };
})(typeof globalThis !== 'undefined' ? globalThis : this);
