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
| Ocean | Pink noise with irregular wave swells (no periodic LFO). |
| Binaural | Optional. The carrier is tuned to the root. Use headphones. |

## Composition

- **Motifs:** Melodies come from a motif memory. The generator makes new motifs (step-wise random walk, phrases end on stable tones) or varies known motifs (transpose, new tail, augment, truncate, invert). This gives recognisable musical ideas instead of random notes.
- **Call and response:** A phrase can be answered by a second instrument, further away in the room.
- **Space:** Every phrase gets a depth plane (near / mid / far) and a stereo position. All planes share one long hall (≈ 9 s), a short room and an irregular stereo echo.
- **Session arc:** Density and brightness follow an arc over the session: *Arriving → Deepening → Stillness → Returning*. Finite sessions fade out at the end. "Endless" repeats the arc with variations.
- **Seed:** The same seed with the same settings gives the same piece.

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

- `index.html` — UI (play, settings, mixer, visuals, export)
- `engine.js` — sound engine (runs in the browser and in Node)
- `tools/render.mjs` — command-line renderer
