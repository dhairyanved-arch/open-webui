"""Audio helpers built on ffmpeg + numpy only (no librosa needed)."""

from __future__ import annotations

import json
import subprocess

import numpy as np


def probe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return float(json.loads(out)["format"]["duration"])


def decode(path: str, sr: int = 22050, start: float | None = None, duration: float | None = None) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += ["-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def cut(path: str, start: float, duration: float, out: str, fade_in: float = 0.35, fade_out: float = 0.7) -> str:
    """Cut the chosen stretch to a WAV with short fades so it never clicks."""
    af = f"afade=t=in:st=0:d={fade_in},afade=t=out:st={max(0.0, duration - fade_out):.3f}:d={fade_out}"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", path, "-vn", "-af", af, "-ar", "48000", "-ac", "2", out],
        check=True,
    )
    return out


def onset_envelope(y: np.ndarray, sr: int, hop: int = 512, n_fft: int = 1024, band: tuple[float, float] | None = None) -> np.ndarray:
    """Log-spectral flux: rises whenever new energy appears (drum hits, syllables)."""
    if len(y) < n_fft:
        return np.zeros(1, dtype=np.float32)
    n = 1 + (len(y) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    mag = np.abs(np.fft.rfft(y[idx] * np.hanning(n_fft)[None, :], axis=1))
    logm = np.log1p(40.0 * mag)
    if band is not None:
        lo, hi = (int(f * n_fft / sr) for f in band)
        logm = logm[:, lo : max(lo + 1, hi)]
    flux = np.maximum(0.0, logm[1:] - logm[:-1]).sum(axis=1)
    flux = np.concatenate([[0.0], flux])
    flux -= np.convolve(flux, np.ones(21) / 21, mode="same")  # local detrend
    flux = np.maximum(0.0, flux)
    return (flux / (flux.max() + 1e-9)).astype(np.float32)


def rhythm_envelope(y: np.ndarray, sr: int) -> np.ndarray:
    """Onset envelope weighted towards the drums (kick below ~160 Hz), which
    carry the beat far more reliably than melodic parts do."""
    return (0.65 * onset_envelope(y, sr, band=(20, 160)) + 0.35 * onset_envelope(y, sr)).astype(np.float32)


def tempo_and_beats(env: np.ndarray, sr: int, hop: int = 512) -> tuple[float, list[float]]:
    """Tempo by autocorrelation (with a gentle preference for ~110 BPM), then the
    beat phase that lines the grid up with the strongest onsets."""
    fps = sr / hop
    if len(env) < int(fps * 4):
        return 0.0, []
    e = env - env.mean()
    ac = np.correlate(e, e, mode="full")[len(e) - 1:]
    lo, hi = int(fps * 60 / 190), int(fps * 60 / 62)
    lags = np.arange(lo, min(hi, len(ac) - 1))
    bpm = 60.0 * fps / lags
    prior = np.exp(-0.5 * (np.log2(bpm / 110.0) / 0.9) ** 2)
    score = ac[lags] * prior
    # a real tempo also correlates at two and four times the lag (half bar, bar)
    for mult, wgt in ((2, 0.5), (4, 0.35)):
        score += wgt * np.where(mult * lags < len(ac), ac[np.minimum(mult * lags, len(ac) - 1)], 0) * prior
    lag = int(lags[int(np.argmax(score))])
    # refine the period with a parabolic fit around the peak
    if 1 <= lag < len(ac) - 1:
        a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
        denom = a - 2 * b + c
        period = float(lag + (0.5 * (a - c) / denom if abs(denom) > 1e-9 else 0.0))
    else:
        period = float(lag)
    best_phase, best = 0.0, -1.0
    for ph in np.linspace(0, period, 48, endpoint=False):
        pos = np.arange(ph, len(env) - 1, period)
        val = float(env[np.round(pos).astype(int)].sum())
        if val > best:
            best, best_phase = val, ph
    beats = [round(float(p) / fps, 3) for p in np.arange(best_phase, len(env), period)]
    return round(float(60.0 * fps / period), 2), beats


def onsets(env: np.ndarray, sr: int, hop: int = 512, thresh: float = 0.12) -> list[float]:
    out = []
    for i in range(1, len(env) - 1):
        if env[i] > thresh and env[i] >= env[i - 1] and env[i] > env[i + 1]:
            out.append(round(i * hop / sr, 3))
    return out


def level_envelope(y: np.ndarray, sr: int, rate: int = 30) -> list[float]:
    """Loudness per video frame, 0..1 — drives the equaliser bars."""
    win = max(1, sr // rate)
    n = len(y) // win
    if n == 0:
        return []
    rms = np.sqrt((y[: n * win].reshape(n, win) ** 2).mean(axis=1))
    rms = rms / (np.percentile(rms, 98) + 1e-9)
    return [round(float(v), 3) for v in np.clip(rms, 0, 1)]
