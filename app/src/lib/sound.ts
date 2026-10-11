"use client";

import { useSyncExternalStore } from "react";

/**
 * Procedural sound design (Web Audio, no audio files). Off by default; the
 * AudioContext is only created after the user turns sound on (a gesture), so
 * browser autoplay rules are respected. The preference persists per browser.
 */

type Cue = "charge" | "launch" | "barrier" | "tunnel" | "reflect" | "confirm" | "tick";

const KEY = "tunnel:sound";
let enabled = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hum: { stop: () => void } | null = null;
const listeners = new Set<() => void>();

try {
  enabled = typeof window !== "undefined" && window.localStorage.getItem(KEY) === "on";
} catch {
  enabled = false;
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function startHum() {
  const ac = audio();
  if (!ac || !master || hum) return;
  const out = ac.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(0.05, ac.currentTime + 2);
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 220;
  const oscs = [42, 42.6, 84.3].map((f, i) => {
    const o = ac.createOscillator();
    o.type = i === 2 ? "triangle" : "sawtooth";
    o.frequency.value = f;
    o.connect(filter);
    o.start();
    return o;
  });
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 0.13;
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  filter.connect(out).connect(master);
  hum = {
    stop: () => {
      const t = ac.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.6);
      [...oscs, lfo].forEach((o) => o.stop(t + 0.7));
    },
  };
}

function stopHum() {
  hum?.stop();
  hum = null;
}

function env(ac: AudioContext, node: AudioNode, peak: number, attack: number, release: number, at = ac.currentTime) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  node.connect(g).connect(master!);
  return g;
}

function noise(ac: AudioContext, seconds: number) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  return src;
}

export function play(cue: Cue) {
  if (!enabled) return;
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime;
  switch (cue) {
    case "charge": {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 1.6);
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 6;
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(1800, t + 1.6);
      o.connect(f);
      env(ac, f, 0.12, 1.4, 0.4);
      o.start(t);
      o.stop(t + 1.9);
      break;
    }
    case "launch": {
      const n = noise(ac, 1.2);
      const f = ac.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.4;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.9);
      n.connect(f);
      env(ac, f, 0.2, 0.05, 1.0);
      n.start(t);
      break;
    }
    case "barrier": {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = 96;
      const trem = ac.createOscillator();
      const tg = ac.createGain();
      trem.frequency.value = 11;
      tg.gain.value = 0.5;
      const g = env(ac, o, 0.16, 0.3, 1.2);
      trem.connect(tg).connect(g.gain);
      o.start(t);
      trem.start(t);
      o.stop(t + 1.6);
      trem.stop(t + 1.6);
      break;
    }
    case "tunnel": {
      [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => {
        const o = ac.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        env(ac, o, 0.07 / (i + 1), 0.01 + i * 0.03, 1.8, t + i * 0.05);
        o.start(t + i * 0.05);
        o.stop(t + 2.2);
      });
      break;
    }
    case "reflect": {
      const o = ac.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.5);
      env(ac, o, 0.18, 0.005, 0.7);
      o.start(t);
      o.stop(t + 0.8);
      break;
    }
    case "confirm": {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(880, t);
      o.frequency.setValueAtTime(1320, t + 0.07);
      env(ac, o, 0.05, 0.005, 0.18);
      o.start(t);
      o.stop(t + 0.3);
      break;
    }
    case "tick": {
      const o = ac.createOscillator();
      o.type = "square";
      o.frequency.value = 2400;
      env(ac, o, 0.012, 0.001, 0.03);
      o.start(t);
      o.stop(t + 0.05);
      break;
    }
  }
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: preference lasts for this page view */
  }
  if (on) {
    startHum();
    play("confirm");
  } else stopHum();
  listeners.forEach((l) => l());
}

/** Restarts the ambient hum after a reload if the user had sound on (on their first interaction). */
export function resumeSoundOnGesture() {
  if (!enabled || typeof window === "undefined") return;
  const go = () => {
    startHum();
    window.removeEventListener("pointerdown", go);
    window.removeEventListener("keydown", go);
  };
  window.addEventListener("pointerdown", go, { once: true });
  window.addEventListener("keydown", go, { once: true });
}

export function useSoundEnabled() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
    () => false,
  );
}
