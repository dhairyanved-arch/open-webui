"""Where the song comes from.

Audio and lyrics are never bundled with this tool. They come from one of:

  * files you pass in (--audio, --lyrics) — always works, fully offline;
  * Apple's public iTunes Search API, which serves an official ~30 s preview
    clip for most tracks;
  * LRCLIB (lrclib.net), a free community database of time-synced lyrics.

Only use material you have the right to use, and check the licence of the
song before publishing a video that contains it.
"""

from __future__ import annotations

import json
import os
import ssl
import urllib.parse
import urllib.request

UA = "songvid/0.1 (lyric video pipeline)"


class FetchError(RuntimeError):
    pass


def _ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        if os.environ.get(var) and os.path.exists(os.environ[var]):
            ctx.load_verify_locations(os.environ[var])
            break
    return ctx


def _get(url: str, timeout: float = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ctx()) as r:
            return r.read()
    except Exception as e:  # network policy, DNS, 4xx/5xx — all mean "not available here"
        raise FetchError(f"could not reach {urllib.parse.urlparse(url).netloc}: {e}") from e


def find_track(query: str) -> dict:
    """Look a song up by free text. Returns title, artist, duration and preview URL."""
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({"term": query, "media": "music", "entity": "song", "limit": 5})
    results = json.loads(_get(url)).get("results", [])
    if not results:
        raise FetchError(f"no track found for {query!r}")
    r = results[0]
    return {
        "title": r.get("trackName", query),
        "artist": r.get("artistName", ""),
        "album": r.get("collectionName", ""),
        "duration": (r.get("trackTimeMillis") or 0) / 1000.0,
        "preview_url": r.get("previewUrl"),
    }


def download_preview(track: dict, out_path: str) -> str:
    if not track.get("preview_url"):
        raise FetchError("this track has no preview clip")
    with open(out_path, "wb") as f:
        f.write(_get(track["preview_url"], timeout=60))
    return out_path


def find_lyrics(title: str, artist: str = "", duration: float = 0.0) -> dict:
    """Synced (and plain) lyrics from LRCLIB. Returns {'synced': str|None, 'plain': str|None}."""
    params = {"track_name": title}
    if artist:
        params["artist_name"] = artist
    hits = json.loads(_get("https://lrclib.net/api/search?" + urllib.parse.urlencode(params)))
    if not hits:
        raise FetchError(f"no lyrics found for {title!r}")

    def rank(h: dict) -> tuple:
        off = abs((h.get("duration") or 0) - duration) if duration else 0
        return (0 if h.get("syncedLyrics") else 1, off)

    best = sorted(hits, key=rank)[0]
    return {"synced": best.get("syncedLyrics"), "plain": best.get("plainLyrics"), "duration": best.get("duration") or 0.0}
