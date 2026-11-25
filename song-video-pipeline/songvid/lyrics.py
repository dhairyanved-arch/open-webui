"""Timed lyrics: parsing, word-level timing, and choosing which part to use.

The pipeline never ships lyric text. Lyrics always arrive at run time, either
from a file the user supplies (.lrc or plain text) or from a lyrics provider
(see sources.py).
"""

from __future__ import annotations

import re
from collections import Counter

LINE_TAG = re.compile(r"\[(\d+):(\d+(?:[.:]\d+)?)\]")
WORD_TAG = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")
OFFSET_TAG = re.compile(r"\[offset:\s*([+-]?\d+)\]", re.I)
META_TAG = re.compile(r"^\[[a-z]+:.*\]$", re.I)


def _secs(m: str, s: str) -> float:
    return int(m) * 60 + float(s.replace(":", "."))


def is_synced(text: str) -> bool:
    return bool(LINE_TAG.search(text))


def parse_lrc(text: str) -> list[dict]:
    """Parse LRC (and enhanced LRC with <mm:ss.xx> word tags) into lines."""
    offset = 0.0
    m = OFFSET_TAG.search(text)
    if m:
        offset = -int(m.group(1)) / 1000.0
    lines = []
    for raw in text.splitlines():
        raw = raw.strip()
        tags = LINE_TAG.findall(raw)
        if not tags:
            continue
        body = LINE_TAG.sub("", raw).strip()
        words = None
        if WORD_TAG.search(body):
            parts = WORD_TAG.split(body)  # [pre, m, s, text, m, s, text...]
            words = []
            for i in range(1, len(parts) - 2, 3):
                at = _secs(parts[i], parts[i + 1]) + offset
                for w in parts[i + 2].split():
                    words.append({"w": w, "s": at})
            body = " ".join(w["w"] for w in words)
        if not body or META_TAG.match(body):
            continue
        for mm, ss in tags:
            line = {"start": max(0.0, _secs(mm, ss) + offset), "text": body}
            if words:
                line["words"] = [dict(w) for w in words]
            lines.append(line)
    lines.sort(key=lambda l: l["start"])
    return lines


def parse_plain(text: str) -> list[str]:
    out = []
    for raw in text.splitlines():
        raw = raw.strip()
        if raw and not (raw.startswith("[") and raw.endswith("]")):
            out.append(raw)
    return out


def syllables(word: str) -> int:
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 1
    n = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and n > 1 and not w.endswith(("le", "ee")):
        n -= 1
    return max(1, n)


def time_words(lines: list[dict], end_of_audio: float, onsets: list[float] | None = None) -> list[dict]:
    """Give every line an end time and every word a start/end.

    With plain line-level timestamps the words are spread across the sung part
    of the line in proportion to their syllable count, then nudged onto nearby
    audio onsets so text lands on the consonants rather than between them.
    """
    onsets = sorted(onsets or [])
    for i, line in enumerate(lines):
        nxt = lines[i + 1]["start"] if i + 1 < len(lines) else end_of_audio
        gap = max(0.3, nxt - line["start"])
        toks = line["text"].split()
        if line.get("words") and all("s" in w for w in line["words"]):
            ws = line["words"]
            for k, w in enumerate(ws):
                w["e"] = ws[k + 1]["s"] if k + 1 < len(ws) else min(nxt, w["s"] + 0.6)
        else:
            syl = [syllables(t) for t in toks]
            sung = min(gap * 0.94, max(0.8, 0.30 * sum(syl) + 0.35))
            weights = [s + 0.35 for s in syl]
            total = sum(weights) or 1.0
            ws, acc = [], 0.0
            for t, wgt in zip(toks, weights):
                s = line["start"] + sung * acc / total
                acc += wgt
                ws.append({"w": t, "s": s, "e": line["start"] + sung * acc / total})
            if onsets:
                for k, w in enumerate(ws):
                    if k == 0:
                        continue
                    near = min(onsets, key=lambda o: abs(o - w["s"]))
                    if abs(near - w["s"]) <= 0.085 and near > ws[k - 1]["s"] + 0.06:
                        w["s"] = near
                        ws[k - 1]["e"] = near
        line["words"] = [{"w": w["w"], "s": round(w["s"], 3), "e": round(max(w["e"], w["s"] + 0.05), 3)} for w in ws]
        line["end"] = round(line["words"][-1]["e"] if line["words"] else line["start"] + gap, 3)
        line["start"] = round(line["start"], 3)
    return lines


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def pick_window(lines: list[dict], duration: float, track_end: float, lead: float = 1.2) -> tuple[float, float]:
    """Choose the most hook-like stretch of the song: the window whose lines are
    repeated the most elsewhere (i.e. the chorus), earliest occurrence first."""
    freq = Counter(_norm(l["text"]) for l in lines)
    best, best_score = 0.0, -1.0
    for line in lines:
        start = max(0.0, line["start"] - lead)
        if start + 8 > track_end:
            break
        inside = [l for l in lines if l["start"] >= start and l["start"] < start + duration - 1.5]
        if not inside:
            continue
        score = sum(freq[_norm(l["text"])] - 1 for l in inside) + 0.15 * len(inside)
        if score > best_score + 1e-6:
            best, best_score = start, score
    return fit_window(lines, best, duration, track_end)


def fit_window(lines: list[dict], start: float, duration: float, track_end: float, shrink: bool = True) -> tuple[float, float]:
    """Trim the window so it never cuts a line off mid-phrase. With shrink=False
    (an explicit --start) the requested length is kept unless a line would be cut."""
    duration = min(duration, track_end - start)
    inside = [l for l in lines if l["start"] >= start - 0.05 and l["start"] < start + duration]
    if inside:
        last = inside[-1]
        nxt = next((l["start"] for l in lines if l["start"] > last["start"]), track_end)
        last_end = min(nxt, last["start"] + max(2.0, 0.34 * sum(syllables(t) for t in last["text"].split()) + 0.8))
        if last_end > start + duration - 0.3 and len(inside) > 1:
            # the final line would be cut off: end the clip just before it starts
            duration = min(duration, last["start"] - start - 0.1)
        elif shrink:
            duration = min(duration, max(8.0, last_end - start + 2.4))
    return round(start, 3), round(duration, 3)


def clip(lines: list[dict], start: float, duration: float) -> list[dict]:
    """Keep the lines that begin inside [start, start+duration) and re-base them."""
    out = []
    for l in lines:
        if l["start"] < start - 0.05 or l["start"] >= start + duration - 0.4:
            continue
        out.append({**{k: v for k, v in l.items() if k != "words"}, "start": max(0.0, l["start"] - start)})
        if l.get("words"):
            out[-1]["words"] = [{**w, "s": max(0.0, w["s"] - start)} for w in l["words"]]
    return out


def on_grid(texts: list[str], beats: list[float], first_at: float | None, beats_per_line: int = 8) -> list[dict]:
    """Untimed lyrics: put one line every N beats, starting on a beat."""
    if len(beats) < 2:
        step = 2.0
        t0 = first_at if first_at is not None else 1.0
        return [{"start": t0 + i * step * 2, "text": t} for i, t in enumerate(texts)]
    period = (beats[-1] - beats[0]) / (len(beats) - 1)
    t0 = first_at if first_at is not None else next((b for b in beats if b >= 4 * period - 0.01), beats[0])
    t0 = min(beats, key=lambda b: abs(b - t0))
    return [{"start": t0 + i * beats_per_line * period, "text": t} for i, t in enumerate(texts)]
