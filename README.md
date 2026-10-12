# HOLO-EXPLORER · Iron Man AR Sim

Tony Stark–style holograms you control with your bare hands, through an ordinary webcam.
Spawn an arc reactor out of thin air, grab it with a fist, flick it into a spin, rip it apart into
an exploded view, pull individual parts out to inspect them, and clap to snap it back together.

Everything runs locally in the browser: [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
tracks 21 landmarks per hand, and [three.js](https://threejs.org) renders the holograms with bloom on top of your camera feed.
No server, no uploads.

![Holo-Explorer: an exploded arc reactor hologram](docs/screenshot.png)

## Quick start

Requirements: Node.js 20+ and a webcam. A recent Chrome or Edge gives the best tracking performance; Safari and Firefox work too.

```bash
npm install
npm run dev
```

Open http://localhost:5173, click **INITIALIZE**, and allow camera access.
No webcam? Click **MOUSE DEMO** to play with the holograms using the mouse.

`npm run dev` first copies MediaPipe's wasm runtime out of `node_modules` and downloads the hand
model (7.8 MB) into `public/`, so after the first run the app works offline. If the download fails,
the app falls back to Google's CDN at runtime.

> Browsers only allow camera access on `https://` or `http://localhost`. To use the app on a phone,
> deploy it (see [Deploying](#deploying)) or tunnel your dev server over HTTPS.

## Gestures

Stand about 0.5–1.5 m from the camera in decent light, with your hands inside the frame.

| Gesture | What it does |
| --- | --- |
| **Pinch & hold** (thumb + index, ~0.6 s) in empty space | Opens the **SPAWN OBJECT** menu: Arc Reactor, Boot Thruster, Holo Globe |
| **Pinch & hold** on a hologram | Opens its control menu: **EXPLODE · ASSEMBLE · RESET PARTS · RESET · REMOVE · CLOSE** |
| In a menu: keep pinching, slide onto an option, release | Selects it (or hover an option and pinch again) |
| **Fist** on a hologram | Grabs it; it follows your hand in 3D, including toward and away from the camera |
| **Two fists** on a hologram | Move, scale (spread or close the fists), and roll (turn them like a steering wheel) |
| **Point & flick** your index finger | Spins the hologram in the direction of the flick |
| **Two fists pulled apart fast** | Explodes the hologram |
| **Palms together, then apart** | Explodes the hologram |
| **Twist a fist counter-clockwise** | Explodes the hologram |
| Exploded: **pinch a part** | Pulls the part out; release to leave it floating there |
| Exploded: **keep holding the part** | Shows its info card (for example `OUTER CASING · DIAMETER 76 mm · SEAL IP68`) |
| **Clap** | Reassembles every exploded hologram |

### Mouse

| Input | What it does |
| --- | --- |
| Double-click | Spawn menu, or the hologram's control menu |
| Drag a hologram | Move it |
| Right-drag or Shift-drag | Rotate; let go mid-drag to fling it spinning |
| Mouse wheel | Scale |
| Drag an exploded part | Pull it out; hold still for its info card |

### Keyboard

| Key | Action |
| --- | --- |
| `E` | Explode / assemble the focused hologram |
| `C` | Next camera |
| `B` | Black & white camera feed |
| `F` | Mirror on/off |
| `I` | Depth invert: pushing your hand toward the screen pushes a held hologram away |
| `L` | Hand and hologram labels |
| `O` | Occlusion: your real hands hide holograms that are behind them |
| `D` | Debug overlay: landmarks, gesture readouts, tracker timing, event log |
| `H` | Help text |
| `Esc` | Close menu |

The **DIM** slider darkens the camera feed so the holograms pop. Settings are remembered per browser.
The **MORE** button reveals the same toggles for touch screens.

## Deploying

`npm run build` produces a static site in `dist/` with relative paths, so it can be hosted from
any directory on any static host.

The included workflow (`.github/workflows/deploy.yml`) type-checks, tests, builds, and publishes
to **GitHub Pages** on every push to `main`. To enable it, open the repository's
**Settings → Pages** and set **Source** to **GitHub Actions**. The app is then served at
`https://<user>.github.io/<repo>/` over HTTPS, so it works on phones too.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?video=<url>` | Use a video file instead of the webcam (loops) |
| `?premirrored=1` | That video is already mirrored, for example a screen recording of a selfie view |
| `?autostart=1` | Skip the start screen |
| `?delegate=CPU` | Run hand tracking on the CPU, for GPUs with flaky WebGL drivers |
| `?clock=video` | Time gestures by the video's own timeline, so recorded clips replay identically however slowly frames are processed |
| `?mirror=0`, `?debug=1`, `?labels=0`, `?occlusion=1`, `?depthInvert=0` | Force a setting for this session |

## How it works

```
webcam ─► HandTracker (MediaPipe, VIDEO mode, GPU→CPU fallback)
            │ 21 image + 21 world landmarks per hand
            ▼
         HandSet / TrackedHand
            One Euro smoothing · metric depth from palm size · 3D reconstruction in camera space
            finger curls · pinch / fist / point / open states with hysteresis
            ▼
         GestureEngine ─► events: pinch/fist edges, flick, twist, clap, palms apart, fists pulled apart
            ▼
         InteractionController ─► menus, grabs, two-hand scale/roll, part dragging, labels
            ▼
         three.js Stage: holograms + hand HUD + occluders ─► bloom ─► composite over the video feed
```

- **Camera-space AR.** The 3D camera's intrinsics match the visible part of the webcam image, so a
  point at the right depth lands exactly on the pixel where the webcam saw it. A hand's distance
  comes from weak perspective: the spread of the rigid palm landmarks in metres (MediaPipe world
  landmarks) over their spread in pixels, times the focal length. Each landmark is then placed on
  its own pixel's view ray, which gives a metric 3D hand that occlusion and depth grabs use.
- **Robust gesture states.** Thresholds were calibrated on real MediaPipe output. One example: a
  pinch with the other fingers curled looks like a fist by finger curl alone. The fingertip
  extension (index tip to wrist ÷ palm length) separates them: tucked fists measured 0.72–1.01,
  pinches 1.1 and up.
- **Holograms** are procedural three.js geometry: fresnel "glass" shells, additive glowing edges,
  and sprites, rendered into an HDR target with `UnrealBloomPass`. A final pass composites them
  over the mirrored, dimmed, and optionally greyscale camera feed in one WebGL canvas. Each object
  is a set of parts with assembled and exploded poses that move on damped springs.

### Project layout

```
src/
  app/          App orchestration and the InteractionController state machine
  core/         Viewport math (image ↔ screen ↔ camera space), One Euro filter, math helpers
  tracking/     MediaPipe wrapper, per-hand state, pure feature extraction
  gestures/     Motion-gesture detectors (pure, unit-tested) and the event engine
  objects/      Explodable hologram framework + Arc Reactor, Boot Thruster, Holo Globe
  render/       Stage (bloom + video composite), materials, hand HUD rig, occluders, effects
  ui/           Controls, edge-docked labels with leader lines, radial menu, start screen, debug overlay
  config.ts     Every tunable: thresholds, filter constants, timings, render settings
tests/          Vitest unit tests (features, detectors, hand states, viewport, filters)
scripts/        setup-assets.mjs (wasm + model into public/)
```

### Adding a hologram

Create a file in `src/objects/` exporting an `ObjectSpec`: a title, menu names, and a list of
parts. Each part has a `build(look)` function that returns three.js geometry, plus its assembled
and exploded positions and info-card rows. Then add it to `CATALOG` in `src/objects/catalog.ts`.
It appears in the spawn menu and supports every gesture automatically. `src/objects/builders.ts`
has helpers for glowing circles, tick rings, glass boxes, and bands.

## Development

```bash
npm run dev         # dev server with hot reload
npm test            # unit tests
npm run typecheck   # TypeScript
npm run build       # typecheck + production build into dist/
```

Gesture thresholds and timings live in `src/config.ts`. Turn on debug mode (`D`) to watch the
live curl, pinch, and extension values and the gesture event log while you tune them.

## Credits

- Hand tracking: [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (Apache-2.0), using Google's hand landmarker model.
- Rendering: [three.js](https://threejs.org) (MIT).
- Inspired by the "Holo-Explorer" hand-tracked hologram demo video, and by the Iron Man films' workshop holograms.
