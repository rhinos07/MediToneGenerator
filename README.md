# MediTone

MediTone is a standalone browser-based meditation music generator built as a single `index.html` file. It creates ambient soundscapes in real time using Tone.js and the Web Audio API, with no external audio samples or MP3 files.

## Features

- Procedurally generated ambient pad progression
- Ocean-wave texture made from filtered pink noise
- Randomized zen chimes
- Stereo binaural beats for headphone listening
- Animated breathing orb and starfield visuals
- Live mixer controls for each sound layer

## Getting Started

1. Clone or download this repository.
2. Open `index.html` in a modern desktop browser.
3. Click **Play** to initialize audio and begin playback.

> Browsers usually require a user gesture before audio can start, so playback begins after pressing the button.

## Controls

- **Play / Pause**: starts or stops the meditation session
- **Ambient Pad**: adjusts the harmonic drone layer
- **Ocean Waves**: adjusts the filtered noise texture
- **Zen Chimes**: adjusts the bell layer
- **Binaural Beats**: adjusts the stereo beat layer

## Technology

- HTML, CSS, and JavaScript in one file
- [Tone.js](https://tonejs.github.io/) for synthesis and scheduling
- Tailwind CSS CDN for utility styling

## Notes

- Headphones are recommended for the binaural beat effect.
- The project currently has no package manager setup, build pipeline, or automated test suite.
