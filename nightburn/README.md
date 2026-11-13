# Nightburn Racing

An original 3D arcade street racer that runs in a phone or desktop browser. Three circuits, four cars, nitro, drifting, jumps and seven rivals.

## Play

Open `index.html` in a browser (it needs a connection the first time, to fetch three.js and the fonts from their CDNs).

| Action | Touch | Keyboard |
| --- | --- | --- |
| Steer | Arrow buttons, or slide mode in Settings | Left / Right or A / D |
| Nitro | N2O button (tap once, burns until empty) | Space |
| Brake / drift | DRIFT button (hold while steering to drift) | Shift or Down |
| Pause | Pause button | Esc or P |

On a phone held upright the game turns itself sideways (landscape mode); switch it with the rotate button on the home screen or Screen in Settings.

The car accelerates on its own. Drifting, air time, pickups and knocking out rivals refill nitro. Credits from each race buy faster cars in the garage.

## Build

The page is assembled from `src/` by a small script with no dependencies:

```
node build.cjs                      # writes index.html
node build.cjs out.html --debug     # test build exposing window.__nb (robot driver, race state)
```
