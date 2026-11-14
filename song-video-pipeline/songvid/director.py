"""The director: decides which prop carries each lyric line.

Three levels, most specific wins:

  1. a storyboard file (hand-written or written by an LLM) names the prop for
     each scene outright;
  2. an art-direction file gives the look plus keyword rules
     ("when a line mentions thunder, use the weather widget");
  3. the built-in rules below, which read each line for what it is *about*
     and pick the prop that makes the words feel like part of the object.
"""

from __future__ import annotations

import random
import re

# prop -> (keyword pattern, weight). A line can match several; highest total wins.
RULES: dict[str, list[tuple[str, float]]] = {
    "map": [(r"\b(where|road|roads|street|town|city|far|away|home|leav\w*|driv\w*|run|running|shores?|river|world|place|miles|way|here|there|north|south|west|east|map)\b", 3.0)],
    "chat": [(r"\b(text|call|called|said|say|says|told|tell|talk|ask|asked|answer|phone|message|reply|hello|hey)\b", 3.0), (r"\b(you|me|i'll|we'll)\b", 0.6)],
    "notification": [(r"\b(wak\w*|waiting|wait|miss|missed|late|alarm|tonight|midnight|ready|now|soon|morning)\b", 2.4)],
    "search": [(r"\b(search\w*|find|finding|looking|look|lost|somewhere|anywhere|what|who|why|how|question|answer)\b", 3.0)],
    "newspaper": [(r"\b(news|story|stories|page|headline|famous|history|legend|everyone|everybody|they|world|never|die|born|gone)\b", 2.2)],
    "polaroid": [(r"\b(picture|pictures|photo\w*|remember\w*|memor\w*|young\w*|summer|days|years?|child\w*|kids?|once|used to|back)\b", 3.0)],
    "sticky": [(r"\b(don't|dont|never|always|forget|promise|note|pin|love|heart|keep|must|should)\b", 2.4)],
    "stars": [(r"\b(stars?|sky|skies|moon|nights?|dream\w*|heaven|shin\w*|galaxy|universe|constellation)\b", 3.2)],
    "weather": [(r"\b(rain\w*|thunder|storm\w*|clouds?|sun|sunny|sunshine|wind|cold|fire|snow|pour\w*|lightning|heat|summer|winter)\b", 3.2)],
    "letter": [(r"\b(dear|father|mother|dad|mom|mama|papa|wrote|write|writing|words|son|daughter|letter|sincerely|told)\b", 3.0)],
    "book": [(r"\b(story|once upon|chapter|tale|legend|life|ever after|the end|page)\b", 2.4)],
    "ticket": [(r"\b(fly|flying|flight|plane|train|ticket|go|gone|going|journey|venture|beyond|travel\w*|leav\w*|away)\b", 2.6)],
    "post": [(r"\b(like|likes|picture|show|see|beautiful|everyone|friends|famous|smile|look at)\b", 2.0)],
    "signs": [(r"!|\b(yes|no|stop|go|run|stay|live|now|wait)\b", 1.6)],
}

# how many words each prop can hold comfortably: (ideal max, hard max)
CAPACITY = {
    "book": (4, 6), "signs": (8, 12), "sticky": (9, 13), "stars": (9, 12), "newspaper": (9, 13), "search": (9, 14),
    "ticket": (11, 16), "polaroid": (9, 14), "map": (10, 16), "weather": (11, 16), "post": (12, 20),
    "chat": (14, 24), "notification": (12, 20), "letter": (16, 30),
}
MULTI_LINE = {"chat", "notification", "polaroid", "signs", "letter", "stars", "sticky"}

MOODS = [
    (r"\b(night\w*|tonight|midnight|dark\w*|stars?|moon|fire|shadow\w*|dream\w*)\b", {"desk": "walnut", "tones": ["night", "ember", "dusk"], "accent": "#ffb24a"}),
    (r"\b(rain\w*|storm\w*|thunder|cold|alone|lonely|cry\w*|tears?|gone|goodbye)\b", {"desk": "ebony", "tones": ["storm", "night", "dusk"], "accent": "#7fb4ff"}),
    (r"\b(sun\w*|summer|morning|gold\w*|shine|bright|day|light)\b", {"desk": "oak", "tones": ["gold", "dawn", "dusk"], "accent": "#ff8a3d"}),
    (r"\b(love|heart|kiss|baby|darling|forever)\b", {"desk": "walnut", "tones": ["dusk", "gold", "dawn"], "accent": "#ff5d7a"}),
]


def pick_look(lines: list[dict]) -> dict:
    text = " ".join(l["text"] for l in lines).lower()
    best, hits = MOODS[0][1], 0
    for pat, look in MOODS:
        n = len(re.findall(pat, text))
        if n > hits:
            best, hits = look, n
    return dict(best)


def group_lines(lines: list[dict], duration: float) -> list[list[int]]:
    """Lines that go by too fast to deserve their own camera move share a prop."""
    groups: list[list[int]] = []
    i = 0
    while i < len(lines):
        g = [i]
        while i + 1 < len(lines) and len(g) < 3:
            span = lines[i + 1]["start"] - lines[g[0]]["start"]
            if lines[i + 1]["start"] - lines[i]["start"] < 1.7 and span < 5.0:
                i += 1
                g.append(i)
            else:
                break
        groups.append(g)
        i += 1
    return groups


def _score(prop: str, text: str, nwords: int, nlines: int) -> float:
    s = 0.0
    for pat, w in RULES.get(prop, []):
        s += w * min(2, len(re.findall(pat, text, re.I)))
    ideal, hard = CAPACITY[prop]
    if nwords > hard:
        s -= 50
    elif nwords > ideal:
        s -= 1.5 * (nwords - ideal)
    if prop == "book" and nwords <= 4:
        s += 1.5
    if prop == "signs" and nwords <= 6:
        s += 1.0
    if nlines > 1 and prop not in MULTI_LINE:
        s -= 50
    return s


def direct(lines: list[dict], meta: dict, art: dict | None = None, seed: int = 1) -> dict:
    """Build a storyboard: the look plus one scene per lyric line (or group)."""
    art = art or {}
    rnd = random.Random(seed)
    duration = meta["duration"]
    look = {**pick_look(lines), **art.get("look", {})}
    rules = art.get("rules", [])
    defaults = art.get("defaults", {})
    allowed = [p for p in CAPACITY if p not in set(art.get("avoid", []))]
    scenes: list[dict] = []
    used: dict[str, int] = {}
    recent: list[str] = []

    for g in group_lines(lines, duration):
        text = " ".join(lines[i]["text"] for i in g)
        nwords = len(text.split())
        prop, opts = None, {}
        for rule in rules:
            if re.search(rule["match"], text, re.I) and rule["prop"] not in recent[-1:]:
                prop, opts = rule["prop"], dict(rule.get("opts", {}))
                break
        if prop is None:
            scored = []
            for p in allowed:
                s = _score(p, text, nwords, len(g)) - 2.6 * used.get(p, 0) + rnd.random() * 0.9
                if p in recent[-2:]:
                    s -= 100
                scored.append((s, p))
            prop = max(scored)[1]
        used[prop] = used.get(prop, 0) + 1
        recent.append(prop)
        scenes.append({"prop": prop, "lines": g, "opts": {**defaults.get(prop, {}), **opts}})

    return {"look": look, "scenes": scenes, "intro": art.get("intro", "player")}


def schedule(storyboard: dict, lines: list[dict], duration: float, lead: float = 0.5) -> list[dict]:
    """Turn the storyboard's scene order into start/end times: the camera lands
    on each prop just before its first word."""
    scenes = []
    for sc in storyboard["scenes"]:
        idx = [i for i in sc.get("lines", []) if 0 <= i < len(lines)]
        if not idx and sc.get("lines"):
            continue
        scenes.append({**sc, "lines": idx})
    timed = [s for s in scenes if s["lines"]]
    timed.sort(key=lambda s: lines[s["lines"][0]]["start"])
    out = []
    prev = 0.0
    for k, sc in enumerate(timed):
        start = max(lines[sc["lines"][0]]["start"] - lead, prev + 0.9 if k else 0.0)
        out.append({**sc, "start": round(start, 3)})
        prev = start
    intro = storyboard.get("intro", "player")
    if out and intro and out[0]["start"] >= 1.3:
        out.insert(0, {"prop": intro, "lines": [], "opts": storyboard.get("intro_opts", {}), "start": 0.0})
    elif out:
        out[0]["start"] = 0.0
    for k, sc in enumerate(out):
        sc["end"] = out[k + 1]["start"] if k + 1 < len(out) else round(duration, 3)
    return out
