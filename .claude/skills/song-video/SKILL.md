---
name: song-video
description: Make a prop-driven kinetic lyric video for a song (lyrics revealed inside objects — map, chat, newspaper, polaroids — with a camera moving across a desk). Use when the user names a song and asks for a video / reel / lyric edit of it.
---

# Song video

The pipeline lives in `song-video-pipeline/` (read its README once). You are the
director: the tool handles audio, timing and rendering; you make the creative
choices.

## Steps

1. **Get the inputs.** You need an audio file and lyrics for the song.
   - If the user attached or pointed to files, use them (`--audio`, `--lyrics`).
   - Otherwise try the automatic fetch (`python songvid.py make "<title> - <artist>" ...`).
     If the network blocks it, ask the user for an audio file and a lyrics file
     (`.lrc` preferred). Do not type lyrics out from memory and do not commit
     lyric text or audio to the repository.
2. **Plan without rendering.**
   `python songvid.py make ... --plan-only` writes `out/<name>/timeline.json`
   (timed lines) and `storyboard.json` (the automatic prop choices).
3. **Direct it.** Read the lines in `timeline.json` and rewrite
   `storyboard.json` so each line sits in the prop that makes it feel like part
   of an object: a line about a place → `map`; something said → `chat`; a
   question → `search`; a memory → `polaroid`; a declaration → `newspaper` or
   `signs`; advice → `letter` or `sticky`; sky → `stars`. Vary the props, give
   each one song-specific `opts` (contact names, place labels, mastheads — your
   own wording, never lyric text), and set a `look` that fits the mood.
   Reusable looks go in `art-direction/*.json`.
4. **Render.** `python songvid.py make ... --storyboard out/<name>/storyboard.json`
5. **Check before you hand it over.** Pull a contact sheet
   (`ffmpeg -i out.mp4 -vf "fps=1/2,scale=360:-2,tile=8x2" -frames:v 1 sheet.jpg`)
   and look at it: text fits its prop, nothing is cut off, the camera lands
   before the first word of each line. Fix the storyboard and re-render if not.
6. Send the video to the user.
