"""Command line entry point.

    python songvid.py make "Song title - Artist" [--audio FILE] [--lyrics FILE] ...

Stages, each writing into the work directory so any one can be redone by hand:

    resolve   find the track, its audio and its timed lyrics
    window    choose which ~30 s of the song to use (the hook, by default)
    analyse   beats, onsets and loudness of that stretch
    direct    assign every lyric line to a prop           -> storyboard.json
    schedule  put the scenes on the clock                  -> timeline.json
    render    headless Chromium, frame by frame, + ffmpeg  -> video.mp4
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import audio as A
from . import director as D
from . import lyrics as L
from . import sources as S

ROOT = Path(__file__).resolve().parent.parent
RENDERER = ROOT / "renderer"


def log(msg: str) -> None:
    print(f"[songvid] {msg}", file=sys.stderr, flush=True)


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "song"


def split_query(q: str) -> tuple[str, str]:
    for sep in (" - ", " – ", " — ", " by "):
        if sep in q:
            a, b = q.split(sep, 1)
            return a.strip(), b.strip()
    return q.strip(), ""


def resolve(args, work: Path) -> dict:
    """Work out title/artist, the audio file and the lyric lines (full-track times)."""
    title, artist = split_query(args.song or "")
    title, artist = args.title or title, args.artist or artist
    track = None
    audio_path = args.audio
    is_preview = False

    if args.silent:
        # no audio at all: render against silence, on a beat grid given by --bpm
        if not args.lyrics or not title:
            raise SystemExit("--silent needs --lyrics and --title.")
        audio_path = str(work / "silence.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{args.duration:.3f}", audio_path],
            check=True,
        )
        args.offline = True

    if not audio_path or not title:
        if args.offline:
            raise SystemExit("--offline needs --audio (and --title).")
        try:
            track = S.find_track(args.song or f"{title} {artist}")
            title, artist = args.title or track["title"], args.artist or track["artist"]
            log(f"found: {title} — {artist}")
            if not audio_path:
                audio_path = S.download_preview(track, str(work / "preview.m4a"))
                is_preview = True
                log("downloaded the official 30 s preview clip")
        except S.FetchError as e:
            if not audio_path:
                raise SystemExit(
                    f"Could not fetch audio ({e}).\n"
                    "Pass your own file instead:  --audio path/to/song.mp3"
                )
            log(f"track lookup skipped ({e})")

    lyric_text = None
    if args.lyrics:
        lyric_text = Path(args.lyrics).read_text(encoding="utf-8")
    elif not args.offline:
        try:
            found = S.find_lyrics(title, artist, track["duration"] if track else 0.0)
            lyric_text = found["synced"] or found["plain"]
            log("fetched " + ("time-synced" if found["synced"] else "plain (untimed)") + " lyrics")
        except S.FetchError as e:
            log(f"lyrics lookup failed ({e})")
    if not lyric_text:
        raise SystemExit(
            "No lyrics available. Pass them in:  --lyrics words.lrc   (time-synced LRC is best;\n"
            "a plain text file with one line per lyric line also works and is placed on the beat)."
        )
    return {
        "title": title or Path(audio_path).stem,
        "artist": artist,
        "audio": audio_path,
        "is_preview": is_preview,
        "track_duration": track["duration"] if track and track["duration"] else None,
        "lyric_text": lyric_text,
    }


def build_timeline(args, work: Path) -> Path:
    src = resolve(args, work)
    audio_len = A.probe_duration(src["audio"])
    synced = L.is_synced(src["lyric_text"])
    want = float(args.duration)
    clip_wav = str(work / "clip.wav")

    if synced:
        lines = L.parse_lrc(src["lyric_text"])
        if not lines:
            raise SystemExit("The lyrics file has timestamps but no lyric lines.")
        last = lines[-1]["start"]
        offset = args.clip_offset
        if offset is None and audio_len + 5 < last:
            # the audio is an excerpt and we were not told where it sits in the song
            raise SystemExit(
                f"The audio is {audio_len:.0f}s long but the lyrics run to {last:.0f}s, so it is an excerpt.\n"
                "Tell me where the excerpt starts in the full song:  --clip-offset SECONDS\n"
                "(or pass the full track with --audio)."
            )
        if offset is not None:
            # excerpt: lyric times are full-track, audio starts at `offset`
            start, dur = L.fit_window(lines, offset + (args.start or 0.0), min(want, audio_len - (args.start or 0.0)), offset + audio_len)
            audio_start = start - offset
        else:
            if args.start is not None:
                start, dur = L.fit_window(lines, args.start, want, audio_len)
            else:
                start, dur = L.pick_window(lines, want, audio_len)
            audio_start = start
        log(f"using {dur:.1f}s starting at {start:.1f}s of the song")
        A.cut(src["audio"], audio_start, dur, clip_wav)
        lines = L.clip(lines, start, dur)
        clip_offset = start
    else:
        audio_start = args.start or 0.0
        dur = min(want, audio_len - audio_start)
        A.cut(src["audio"], audio_start, dur, clip_wav)
        lines = None
        clip_offset = (args.clip_offset or 0.0) + audio_start

    y = A.decode(clip_wav)
    bpm, beats = A.tempo_and_beats(A.rhythm_envelope(y, 22050), 22050)
    ons = A.onsets(A.onset_envelope(y, 22050), 22050)
    if args.bpm:
        bpm = float(args.bpm)
        beats = [round(k * 60.0 / bpm, 3) for k in range(int(dur * bpm / 60.0) + 1)]
    log(f"tempo ≈ {bpm:.0f} BPM, {len(beats)} beats, {len(ons)} onsets")

    if lines is None:
        texts = L.parse_plain(src["lyric_text"])
        lines = L.on_grid(texts, beats, args.first_line_at, args.beats_per_line)
        lines = [l for l in lines if l["start"] < dur - 1.0]
        log(f"untimed lyrics: placed {len(lines)} lines on the beat grid, every {args.beats_per_line} beats")
    if not lines:
        raise SystemExit("No lyric lines fall inside the chosen part of the song. Try --start.")
    lines = L.time_words(lines, dur, ons)
    for i, l in enumerate(lines):
        l["i"] = i

    w, h = (int(v) for v in args.size.lower().split("x"))
    meta = {
        "title": src["title"],
        "artist": src["artist"],
        "duration": round(dur, 3),
        "fps": args.fps,
        "width": w,
        "height": h,
        "seed": args.seed,
        "bpm": bpm,
        "beats": beats,
        "clipOffset": round(clip_offset, 2),
        "trackDuration": src["track_duration"] or round(max(audio_len, clip_offset + dur), 1),
        "env": A.level_envelope(y, 22050, args.fps),
        "envRate": args.fps,
    }

    art = json.loads(Path(args.art).read_text()) if args.art else None
    if args.storyboard:
        board = json.loads(Path(args.storyboard).read_text())
        log(f"using storyboard {args.storyboard}")
    else:
        board = D.direct(lines, meta, art, seed=args.seed)
    board.setdefault("look", D.pick_look(lines))
    if art and art.get("look"):
        board["look"] = {**board["look"], **art["look"]}
    for sc in board["scenes"]:
        img = (sc.get("opts") or {}).get("image")
        if isinstance(img, str) and not re.match(r"^(data:|https?:|file:)", img):
            sc["opts"]["image"] = Path(img).resolve().as_uri()

    # keep a readable copy of the plan next to the output; edit it and re-run
    # with --storyboard to change any creative decision
    plan = {
        "look": board["look"],
        "intro": board.get("intro", "player"),
        "scenes": [{"prop": s["prop"], "lines": s["lines"], "opts": s.get("opts", {})} for s in board["scenes"]],
    }
    (work / "storyboard.json").write_text(json.dumps(plan, indent=2))
    scenes = D.schedule(board, lines, dur)
    timeline = {"meta": meta, "look": board["look"], "lines": lines, "scenes": scenes}
    out = work / "timeline.json"
    out.write_text(json.dumps(timeline))
    log("scenes: " + " → ".join(s["prop"] for s in scenes))
    return out


def render(timeline: Path, out: Path, audio: Path | None, workers: int, extra: list[str] | None = None) -> None:
    if not (RENDERER / "node_modules").exists():
        log("installing renderer fonts (npm install)…")
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=RENDERER, check=True)
    cmd = ["node", str(RENDERER / "render.cjs"), "--timeline", str(timeline), "--out", str(out), "--workers", str(workers)]
    if audio:
        cmd += ["--audio", str(audio)]
    subprocess.run(cmd + (extra or []), check=True)


def cmd_make(args) -> None:
    for tool in ("ffmpeg", "ffprobe", "node"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} is required but was not found on PATH.")
    name = slugify(args.name or args.title or split_query(args.song or "")[0] or Path(args.audio or "song").stem)
    work = Path(args.workdir or ROOT / "out" / name)
    work.mkdir(parents=True, exist_ok=True)
    timeline = build_timeline(args, work)
    if args.plan_only:
        log(f"plan written to {work / 'storyboard.json'} (no video rendered)")
        return
    out = Path(args.out) if args.out else work / f"{name}.mp4"
    render(timeline, out, work / "clip.wav", args.workers)
    log(f"done: {out}")
    print(out)


def cmd_render(args) -> None:
    render(Path(args.timeline), Path(args.out), Path(args.audio) if args.audio else None, args.workers)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="songvid", description="Turn a song into a prop-driven kinetic lyric video.")
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("make", help="song in, video out")
    m.add_argument("song", nargs="?", help='song to look up, e.g. "Title - Artist"')
    m.add_argument("--audio", help="your own audio file (full track or an excerpt)")
    m.add_argument("--lyrics", help="lyrics file: time-synced .lrc (best) or plain text, one line per line")
    m.add_argument("--title")
    m.add_argument("--artist")
    m.add_argument("--start", type=float, help="where in the audio to begin (default: auto-pick the hook)")
    m.add_argument("--duration", type=float, default=30.0, help="target length in seconds (default 30)")
    m.add_argument("--clip-offset", type=float, help="if --audio is an excerpt: where it starts in the full song (s)")
    m.add_argument("--first-line-at", type=float, help="untimed lyrics: when the first line starts (s)")
    m.add_argument("--beats-per-line", type=int, default=8, help="untimed lyrics: beats between lines (default 8)")
    m.add_argument("--bpm", type=float, help="use this tempo for the beat grid instead of detecting it")
    m.add_argument("--silent", action="store_true", help="no audio: time the video on the --bpm grid and add the music later")
    m.add_argument("--art", help="art-direction JSON (look + keyword→prop rules)")
    m.add_argument("--storyboard", help="explicit storyboard JSON (skips the automatic director)")
    m.add_argument("--plan-only", action="store_true", help="write storyboard.json/timeline.json but do not render")
    m.add_argument("--size", default="1080x1920")
    m.add_argument("--fps", type=int, default=30)
    m.add_argument("--seed", type=int, default=1, help="change for a different layout / prop choice")
    m.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 2))
    m.add_argument("--offline", action="store_true", help="never touch the network")
    m.add_argument("--name", help="output name (default: from the title)")
    m.add_argument("--workdir")
    m.add_argument("--out")
    m.set_defaults(fn=cmd_make)

    r = sub.add_parser("render", help="render an existing timeline.json")
    r.add_argument("--timeline", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--audio")
    r.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 2))
    r.set_defaults(fn=cmd_render)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
