# songvid — song in, prop-driven lyric video out

Give it a song and it renders a vertical (1080×1920) kinetic lyric video in the
"lyrics live inside real objects" style: every line of the song is revealed
*inside a prop* — typed into a search bar, sent as a text message, printed as a
newspaper headline, written on a polaroid, drawn as a constellation — while a
camera glides and whip-pans across a wooden desk in time with the music.

```
python songvid.py make "Song Title - Artist" --audio song.mp3 --lyrics song.lrc
```

Everything is drawn procedurally (desk, photos, maps, UI), so there are no
stock assets to source and each render is deterministic.

## How it works

| stage | what happens | output |
|---|---|---|
| **resolve** | finds the track, its audio and its lyrics | – |
| **window** | picks the ~30 s to use — by default the most-repeated stretch (the hook) | `clip.wav` |
| **analyse** | tempo, beat grid, onsets and loudness from the audio (numpy only) | – |
| **time** | line timestamps → per-word timings, snapped to audio onsets | – |
| **direct** | reads each line for what it is *about* and assigns it a prop | `storyboard.json` |
| **schedule** | puts scenes on the clock; camera lands just before each first word | `timeline.json` |
| **render** | headless Chromium draws every frame via `seek(t)`; ffmpeg encodes + muxes | `<name>.mp4` |

Because frames are a pure function of time, text lands exactly on its
timestamps and the same timeline always produces the same video.

## Requirements

- Python 3.10+ with `numpy`
- `ffmpeg` / `ffprobe`
- Node 18+ and Playwright's Chromium (`npm i -g playwright && npx playwright install chromium`)
- fonts are pulled automatically on first run (`npm install` in `renderer/`, all open-licensed)

## Inputs

**Audio** — pass your own file with `--audio` (full track or an excerpt). If
you omit it, the tool looks the song up on the iTunes Search API and uses the
official ~30 s preview clip.

**Lyrics** — pass `--lyrics`:

- a time-synced **`.lrc`** file is best (word-tagged "enhanced" LRC is used as-is);
- a **plain text** file, one lyric line per line, also works: lines are laid on
  the detected beat grid (`--first-line-at`, `--beats-per-line` to adjust).

If you omit it, the tool asks LRCLIB for synced lyrics.

No audio or lyrics ship with this tool, and it never writes lyric text into the
repository — both arrive at run time. Use material you have the right to use
and check the song's licence before publishing a video that contains it.

### Common invocations

```bash
# your own full track + synced lyrics: the hook is chosen automatically
python songvid.py make --audio track.mp3 --lyrics track.lrc --title "Title" --artist "Artist"

# choose the part yourself
python songvid.py make --audio track.mp3 --lyrics track.lrc --title "Title" --start 62 --duration 28

# the audio is an excerpt that begins 1:02 into the song
python songvid.py make --audio excerpt.m4a --lyrics track.lrc --title "Title" --clip-offset 62

# fully automatic (needs network access to itunes.apple.com and lrclib.net);
# previews are excerpts, so say where the preview starts in the song
python songvid.py make "Title - Artist" --clip-offset 45

# no audio yet: time the lines on a tempo grid and add the music afterwards
python songvid.py make --silent --bpm 103 --lyrics words.lrc --title "Title" --duration 40

# see the plan without rendering, edit it, then render from it
python songvid.py make ... --plan-only
python songvid.py make ... --storyboard out/<name>/storyboard.json
```

Useful flags: `--seed N` (different layout and prop choices), `--size 1080x1350`,
`--fps 30`, `--workers 4`, `--offline`.

## Creative control

Three levels, most specific wins.

**1. Built-in director** (default). Keyword rules in `songvid/director.py` score
each prop against each line — places and movement go to the map, anything said
or told becomes a chat or notification, questions go to the search bar,
memories to polaroids, sky words to the star chart, weather to the weather
widget, and so on — with penalties for repeating a prop and for overfilling one.
Lines that fly past too fast to deserve a camera move share a prop.

**2. Art direction** (`--art file.json`). Sets the look and adds your own
routing rules and per-prop defaults. See `examples/demo/art.json` and
`art-direction/the-nights.json`.

```jsonc
{
  "look": { "desk": "walnut", "tones": ["night", "ember"], "accent": "#ffb24a", "masthead": "The Late Edition" },
  "defaults": { "chat": { "contact": "June" } },
  "rules": [ { "match": "\\bthunder\\b", "prop": "weather", "opts": { "condition": "storm" } } ]
}
```

**3. Storyboard** (`--storyboard file.json`). Names the prop for every scene
outright; `lines` are indexes into the clip's lyric lines. This is what
`--plan-only` writes, and what an LLM (or you) can author for a fully bespoke cut.

```jsonc
{ "look": { "desk": "ebony" },
  "scenes": [ { "prop": "map", "lines": [0], "opts": { "to": "Out of town" } },
              { "prop": "chat", "lines": [1, 2] } ] }
```

### Props

| prop | the line appears as… | notable `opts` |
|---|---|---|
| `map` | a navigation banner while a route draws itself | `to`, `from`, `places`, `eta` |
| `search` | a query typed into a search sheet | `suggestions`, `label` |
| `chat` | message bubbles in a phone (typing dots first) | `contact`, `history`, `sides` |
| `notification` | lock-screen notifications | `sender`, `time`, `date` |
| `newspaper` | a typed front-page headline | `masthead`, `kicker`, `edition` |
| `polaroid` | handwritten captions under photos | `photos`, `tones`, `image` |
| `sticky` | marker on a pinned sticky note | `color`, `doodle` |
| `signs` | words on taped-up paper strips | – |
| `letter` | handwriting on a ruled page | `greeting`, `sign`, `date` |
| `book` | a gold title on a cloth-bound book (short lines) | `color`, `top`, `foot` |
| `ticket` | typewriter text on a boarding pass | `from`, `to`, `label` |
| `post` | the caption of a photo post | `user`, `place`, `likes`, `image` |
| `weather` | an advisory on a weather widget | `condition`, `location`, `alert` |
| `stars` | a constellation, one star per word | – |
| `player` | (intro) a now-playing card with live equaliser | `photo`, `image` |

`look.desk`: `walnut`, `oak`, `ebony`, `slate`. `look.tones` / `opts.tones`:
`dusk`, `night`, `gold`, `dawn`, `storm`, `ember`. Photo kinds: `hills`,
`figures`, `figure`, `campfire`, `road`, `city`, `shore`, `stars`, `window`.
Any photo can be replaced with your own picture via `opts.image`.

### Adding a prop

A prop is ~40 lines in `renderer/stage/props/`:

```js
SV.props.myprop = {
  size: { w: 800, h: 600 },
  build(scene, ctx, box) {                       // box is an empty w×h element
    const txt = SV.h('div.my-text');
    box.append(txt);
    const tt = SV.timedText(txt, ctx.words, { mode: 'type' }); // type | write | pop | fade
    SV.fit(txt, 700, 300, 90, 30);
    return { update: (t) => tt.update(t) };      // pure function of clip time
  }
};
```

Then give it keywords and a word capacity in `songvid/director.py`.

## Demo

`examples/demo` contains an original song written for this repo — a
synthesised backing track and its own words — so the whole pipeline can be run
without any third-party music:

```bash
python examples/demo/make_demo_audio.py /tmp/demo.wav
python songvid.py make --audio /tmp/demo.wav --lyrics examples/demo/lyrics.lrc \
  --title "Paper Maps" --artist "songvid demo" --art examples/demo/art.json \
  --start 0 --duration 36 --offline
```

## Status

Tested end to end with local audio + `.lrc` (the demo above). The network
fetchers in `songvid/sources.py` (iTunes preview, LRCLIB) are written against
the public APIs but were **not exercised** in the sandbox this was built in,
which blocks those hosts. Word timings inside a line are estimated from
syllable counts and audio onsets unless the LRC carries word tags.
