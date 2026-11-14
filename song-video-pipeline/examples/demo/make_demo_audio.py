#!/usr/bin/env python3
"""Synthesises a short original backing track (120 BPM, A minor) for the demo.

The demo exists so the whole pipeline can be exercised without any third-party
music: this track and the words in lyrics.lrc were written for this repository.

    python make_demo_audio.py demo.wav
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
BARS = 18
rng = np.random.default_rng(4)
N = int(BARS * 4 * BEAT * SR)
mix = np.zeros(N)


def add(sig, at, gain=1.0):
    i = int(at * SR)
    j = min(N, i + len(sig))
    if i < N:
        mix[i:j] += sig[: j - i] * gain


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / attack) * np.exp(-t / decay)


def note(freq, dur, kind="pluck"):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if kind == "pluck":
        s = sum(np.sin(2 * np.pi * freq * k * t) / k**1.6 for k in range(1, 7))
        return s * env(n, 0.004, dur * 0.28)
    if kind == "bass":
        s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t)
        return s * env(n, 0.008, dur * 0.6)
    s = sum(np.sin(2 * np.pi * freq * d * t + p) for d, p in ((0.996, 0), (1.0, 1), (1.004, 2)))
    return s * np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.3)


def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11)


def noise(dur, decay, hp):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    x = x - np.convolve(x, np.ones(hp) / hp, mode="same")
    return x * env(n, 0.001, decay)


A2, C3, F2, G2 = 110.0, 130.81, 87.31, 98.0
CHORDS = [
    (A2, [220.0, 261.63, 329.63]),
    (F2, [174.61, 220.0, 261.63]),
    (C3, [196.0, 261.63, 329.63]),
    (G2, [196.0, 246.94, 293.66]),
]

for bar in range(BARS):
    t0 = bar * 4 * BEAT
    root, tones = CHORDS[bar % 4]
    full = 1 <= bar < BARS - 1
    for f in tones:
        add(note(f, 4 * BEAT, "pad"), t0, 0.05)
    for b in range(4):
        tb = t0 + b * BEAT
        if full:
            if b in (0, 2):
                add(kick(), tb, 0.9)
            else:
                add(noise(0.2, 0.06, 6), tb, 0.28)
            add(noise(0.05, 0.015, 3), tb + BEAT / 2, 0.12)
            add(noise(0.05, 0.012, 3), tb, 0.07)
        add(note(root, BEAT * 0.9, "bass"), tb, 0.34 if full else 0.2)
        for s in range(4):  # sixteenth-note arpeggio
            f = tones[(b * 4 + s) % 3] * (2 if (s + bar) % 4 == 3 else 1) * 2
            add(note(f, BEAT * 0.5), tb + s * BEAT / 4, 0.085 if full else 0.05)

mix = np.tanh(mix * 1.5)
fade = int(1.5 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)
stereo = np.stack([mix, np.roll(mix, 180)], axis=1)
pcm = (stereo / np.abs(stereo).max() * 0.9 * 32767).astype(np.int16)
out = sys.argv[1] if len(sys.argv) > 1 else "demo.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(out)
