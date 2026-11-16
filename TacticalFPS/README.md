# TacShooter — 5v5 tactical mobile FPS (Unreal Engine 5.2, C++)

Gameplay code for a landscape-only, touch-first tactical shooter: bomb defusal and team
deathmatch, a buy phase with an economy, learnable spray patterns, a 60 Hz server with
server-side hit registration and lag compensation, and a HUD and touch-control scheme built
for phones.

**Status: this code has not been compiled.** It was written against the UE 5.2 API without an
engine available to build it, so expect to fix some compile errors on the first build. It also
contains no art: the map, character and weapon models, animations, effects and sounds are
content you create or license and plug into the slots described under "Content to add".

## What is here

| Requested | File | What it does |
|---|---|---|
| Core game loop | `TacGameMode`, `TacGameState`, `TacPlayerState` | Round state machine, win conditions, economy, team assignment, spawning, side swap, buy rules, kill feed |
| Player controller for touch | `TacPlayerController`, `TacTouchLayout` | Finger routing, floating movement stick, drag-to-aim, fire-and-aim on one thumb, aim-assist friction, grenade wheel, customisable saved layout |
| UI layout | `UI/STacHUDWidget`, `UI/STacBuyMenu`, `UI/TacHUD` | Minimap (top left), timer, score and kill feed (top right), HP and AP (bottom left), ammo, crosshair, touch controls, buy menu |
| Supporting gameplay | `TacCharacter`, `TacCharacterMovementComponent`, `TacLagCompensationComponent`, `TacWeaponData`, `TacGrenade`, `TacBomb` | Gunplay and recoil, movement, rewind hit tests, weapon stats, flash / smoke / HE, bomb and bomb sites |

Everything is under `Source/TacShooter`. Settings are in `Config/`.

## The loop

Bomb defusal:

```
WaitingForPlayers ─► BuyPhase ─► Live ─┬─► RoundEnd ─► (next round, or MatchEnd)
                     15 s        1:55  │
                     frozen            └─► BombPlanted (40 s) ─► RoundEnd
```

- A round ends on elimination, on the clock (defenders win), on detonation, or on a defuse.
  After the plant, killing every attacker is not enough — the bomb still has to be defused.
- First to 13 rounds wins; sides swap after 12. A 12–12 finish is a draw (no overtime).
- Money: 800 to start, 3250 for a win, 1400 + 500 per consecutive loss for a loss, a kill
  reward per weapon, 300 for a plant or defuse. Survivors keep their gear; the dead restart
  with the sidearm.
- Team deathmatch reuses the same mode: respawns after 3 s away from enemies, free loadouts
  for 10 s after each spawn, first team to 75 kills or 10 minutes.

All of these numbers are properties on `ATacGameMode`.

## Gunplay

- Each weapon has a fixed spray pattern (`RecoilPattern`, degrees per shot). The first shot
  goes exactly where you aim; the view then climbs and sways along the pattern, and you
  counter it by dragging against it. Releasing the trigger walks the pattern back down.
- Spread is separate from recoil and depends on stance: tight when still or crouched,
  unchanged at walking speed, wide when running and wider in the air. The crosshair gap is
  the real cone projected on screen.
- Time to kill is short: the attackers' rifle kills an armored target with four chest shots
  (about 0.3 s) or one headshot, helmet or not.
- Five built-in weapons are defined in code in `UTacWeaponCatalog::BuildDefaultArsenal`, so
  the game is playable before any asset exists. Change the numbers there, or register your
  own `UTacWeaponData` assets with `RegisterWeapon`.

## Movement

Run 450 cm/s (audible), walk 235 (silent), crouch 155 (silent), scaled by the weapon carried.
Fast acceleration and braking make stopping before a shot quick. Walk and aim-down-sights are
part of the predicted move, so speed changes do not rubber-band. A light push on the stick
walks; a full push runs — the inner ring on the stick marks the threshold.

## Touch controls

- Left side: floating movement stick (appears under the thumb, follows it past the rim).
- Right side: drag anywhere to aim. The fire button also aims while held.
- Buttons: fire, ADS (toggle), reload, crouch (toggle), jump, weapon swap, grenades.
  Plant / defuse and buy appear only when they can be used.
- Grenades: tap the button to cycle, or hold and slide onto flash, smoke or HE. Fire throws.
- Aim assist is friction only: near an enemy in line of sight, your own swipe is scaled down
  (up to 45 %, 55 % when aiming). It never adds rotation, so it cannot snap or track, and it
  does not work through walls or smoke.
- Customising: `TacEditLayout 1` then drag any control; `TacEditLayout 0` saves. Also
  `TacScaleControl <index> <scale>`, `TacSetSensitivity <value>`, `TacSetAimAssist <0..1>`,
  `TacResetLayout`. These are console commands for now; a settings screen should call the same
  functions.

## Netcode

- The client predicts its own shot for feel (ammo, recoil, tracer). The server decides hits.
- The client sends only where it was aiming. The server applies the spray pattern and spread
  itself, checks fire rate and ammo, and checks the shot started at the shooter's eyes.
- Lag compensation: the server records every character's hitboxes each tick and tests the shot
  against where targets were when the shooter fired. The rewind amount is the server's own
  measurement of the shooter's ping plus the interpolation delay, capped at 250 ms.
- Hitboxes are simple shapes derived from the capsule (head, chest, stomach, legs), so the
  server never animates skeletons.

## Getting it running

1. Install UE 5.2 with Android and/or iOS support. Right-click `TacShooter.uproject` →
   *Generate project files*, then build the editor target.
2. Create a level. Add `PlayerStart` actors and set **Player Start Tag** to `Attackers` or
   `Defenders` (at least five each). Add one or two `TacBombSite` actors, size their boxes, and
   name them `A` and `B`.
3. The default game mode is already `TacGameMode`. For deathmatch, open the map with
   `?Mode=TDM`.
4. Play in editor with 2 players (the match starts at `MinPlayersToStart`, default 2; set it
   to 1 to walk around alone, 10 for a real 5v5). Keyboard and mouse work in the editor: WASD,
   mouse, Shift walk, Ctrl crouch, Space, R, E plant/defuse, Q swap, G grenade, B buy. To test
   the touch controls with a mouse, turn on *Use Mouse for Touch* in Project Settings → Input.
5. For real matches, build `TacShooterServer` (needs a source build of the engine) and run it
   as a dedicated server.

## Content to add

| Content | Where it plugs in |
|---|---|
| Map (geometry, baked lighting, collision) | Your level. Give materials a physical material with surface Stone, Metal or Wood for impacts |
| Character body and first-person arms | Blueprint subclass of `TacCharacter`: `Mesh`, `ArmsMesh`, animation blueprints. Use different meshes per team for readable silhouettes |
| Weapon meshes, fire and reload animations, muzzle flash, tracer, impacts, sounds | The presentation fields on each `UTacWeaponData` |
| Grenade and bomb meshes, explosion / flash / smoke effects, sounds | Blueprint subclasses of `TacGrenade` and `TacBomb`, set as `GrenadeClass` / `BombClass` |
| Footstep sound | `FootstepSound` on the character |
| LODs | Author LODs on every mesh; `Config/DefaultDeviceProfiles.ini` biases them per device tier |

## Not implemented

Bots, matchmaking and lobbies, anti-cheat beyond the server checks above, bullet penetration
through walls, a melee weapon, overtime, a scoreboard screen, a settings menu, reconnect, and
voice or text chat.

## Things to verify first on a real build

- Slate drawing and the touch-event override are the most engine-version-sensitive parts
  (`STacHUDWidget.cpp`, `ATacPlayerController::InputTouch`).
- The settings in `Config/` are a starting point; confirm them in Project Settings.
- Frame rate is a content question as much as a code one: profile on target devices and tune
  `DefaultDeviceProfiles.ini`.
