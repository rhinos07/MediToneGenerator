// Offline renderer for MediTone (Node.js).
// Renders a session to a 16-bit WAV file without a browser.
//
//   npm install node-web-audio-api
//   node tools/render.mjs out.wav --minutes 30 --seed lotus-108 --key D --mode dorian
//
// Options: --minutes, --seed, --key (C, C#, D, …), --mode (dorian, aeolian,
// pentaMajor, pentaMinor, lydian, hijaz), --movement 0..1, --density 0..1,
// --reverb 0..1, --levels '{"tanpura":-12,"ocean":-40}'
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as WA from 'node-web-audio-api';

const args = process.argv.slice(2);
const outPath = args.find(a => !a.startsWith('--')) || 'meditone.wav';
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };

// Load engine.js into a sandbox that provides the Web Audio API
const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { ...WA, Math, console, setTimeout, Promise, Object, Array, Set, String, isFinite, Float32Array, ArrayBuffer, DataView };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(here, '..', 'engine.js'), 'utf8'), sandbox);
const M = sandbox.MediToneEngine;

const key = opt('key') || 'D';
const cfg = {
  seed: opt('seed') || 'meditone',
  rootPc: Math.max(0, M.ROOTS.indexOf(key)),
  mode: opt('mode') || 'dorian',
  movement: Number(opt('movement') ?? 0.5),
  density: Number(opt('density') ?? 0.5),
  reverb: Number(opt('reverb') ?? 0.6),
  levels: JSON.parse(opt('levels') || '{}'),
};
const seconds = Number(opt('minutes') || 20) * 60;

console.log(`Rendering ${seconds / 60} min, seed "${cfg.seed}", ${key} ${cfg.mode} …`);
const t0 = Date.now();
const buf = await M.renderOffline(cfg, seconds, WA.OfflineAudioContext, 44100);
fs.writeFileSync(outPath, Buffer.from(M.encodeWav(buf)));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${outPath}`);
