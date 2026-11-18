# MediTone — Generative Meditation Music

MediTone generates endless, rhythm-free ambient music for yoga, meditation and relaxation.
All sound is synthesised in real time with the Web Audio API. There are no samples.

Open `index.html` in a browser (or serve the folder, e.g. with GitHub Pages) and press play.

## Sound layers

| Layer | What it does |
|---|---|
| Drone | Root and fifth. Always present. The filter and the level "breathe" at unrelated slow rates. |
| Pad | Four voices. Each voice moves on its own random schedule by a small step inside the mode (voice leading). There is no common chord change, so there is no hidden pulse. A quiet "halo" (octave and twelfth) goes only into the hall reverb. |
| Flutes | Bansuri and shakuhachi style. Legato phrases with pitched breath noise, onset chiff, delayed vibrato, glides and scoops. |
| Handpan | Modal synthesis (fundamental, octave, twelfth, slight beating). |
| Singing Bowls | Inharmonic partials with beating. Struck or rubbed. A bowl opens and closes each session. |
| Tanpura | Optional jawari-like drone plucks. Off by default. |
| Water (Ocean) | Pink noise with irregular wave swells (no periodic LFO). |
| Binaural | Optional. The carrier is tuned to the root. Use headphones. |

## Composition

- **Motifs:** Melodies come from a motif memory. The generator makes new motifs (step-wise random walk, phrases end on stable tones) or varies known motifs (transpose, new tail, augment, truncate, invert). This gives recognisable musical ideas instead of random notes.
- **Call and response:** A phrase can be answered by a second instrument, further away in the room.
- **Space:** Every phrase gets a depth plane (near / mid / far) and a stereo position. All planes share one long hall (≈ 9 s), a short room and an irregular stereo echo.
- **Session arc:** Density and brightness follow an arc over the session: *Arriving → Deepening → Stillness → Returning*. Finite sessions fade out at the end. "Endless" repeats the arc with variations.
- **Seed:** The same seed with the same settings gives the same piece.

## Design

The main screen shows a singing bowl in a calm natural scene. All scenes are drawn procedurally (no photos).

- **Scenes:** *Mountain lake* (default), *Forest grove*, *Candle night*.
- **Light follows the session:** dawn while arriving, brightest in stillness, dusk while returning.
- **Bowl:** ripples on the water follow the audio level. Click the bowl to play or pause.
- **Presets:** *Lake Calm*, *Forest Calm*, *Deep Bowls*, *Water Breath*, *Sleep*. A preset sets mode, character, layer levels and scene. Key and seed stay.
- **Breathing guide:** the cue switches between *breathe in*, *hold* and *breathe out*. Bowl and halo grow and sink with the breath, a thin ring fills during each step. Patterns: *Calm 4–6* (default), *4–7–8*, *Box 4–4–4–4*, *Off*. An optional soft bowl chime marks each in/out change (also when the tab is in the background). The chime is not part of the WAV export.
- All other settings are in the **Settings** drawer.
- **Performance:** the scene renders at half resolution and max. 30 fps. *Eco mode* (settings → Scene) keeps the scene still and redraws it only every 2 s; use it on slow notebooks or on battery. `prefers-reduced-motion` uses the same still mode.

See `docs/design-concept.md` for the full concept.

## Controls

- **Session:** duration, mood/mode (Dorian, Aeolian, pentatonic, minor pentatonic, Lydian, Hijaz), key, seed.
- **Character:** *Movement* (how often pad voices shift, 0 = static drone), *Density* (how often melodies appear), *Space* (hall amount).
- **Sound Layers:** one level per layer. Far left = off.
- **Render WAV:** renders the session offline in the browser (max 20 min because of browser memory).

## Long renders without a browser

```bash
npm install node-web-audio-api
node tools/render.mjs session.wav --minutes 45 --seed lotus-108 --key D --mode dorian
```

Options: `--minutes`, `--seed`, `--key`, `--mode`, `--movement`, `--density`, `--reverb`, `--levels '{"tanpura":-12}'`.

## Files

- `index.html` — UI (scenes, singing bowl, presets, settings drawer, export)
- `engine.js` — sound engine (runs in the browser and in Node)
- `tools/render.mjs` — command-line renderer
