// Copies the MediaPipe Tasks Vision wasm runtime out of node_modules and downloads the
// hand landmarker model into public/, so the app runs without hitting a CDN at runtime.
// Both steps are best-effort: if anything is missing the app falls back to the CDN.
import { copyFile, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WASM_SRC = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DEST = join(root, 'public/mediapipe/wasm');
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_DEST = join(root, 'public/models/hand_landmarker.task');

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

async function copyWasm() {
  await mkdir(WASM_DEST, { recursive: true });
  for (const file of WASM_FILES) {
    const src = join(WASM_SRC, file);
    const dest = join(WASM_DEST, file);
    const srcSize = await sizeOf(src);
    if (srcSize < 0) throw new Error(`missing ${src} (did you run npm install?)`);
    if ((await sizeOf(dest)) !== srcSize) await copyFile(src, dest);
  }
  console.log('[setup-assets] MediaPipe wasm runtime ready in public/mediapipe/wasm');
}

async function downloadModel() {
  if ((await sizeOf(MODEL_DEST)) > 1_000_000) {
    console.log('[setup-assets] hand model already present');
    return;
  }
  if (process.env.SKIP_MODEL_DOWNLOAD) {
    console.log('[setup-assets] SKIP_MODEL_DOWNLOAD set; the app will load the model from the CDN');
    return;
  }
  await mkdir(dirname(MODEL_DEST), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${MODEL_URL}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tmp = `${MODEL_DEST}.part`;
  await writeFile(tmp, bytes);
  await rename(tmp, MODEL_DEST);
  console.log(`[setup-assets] downloaded hand model (${(bytes.length / 1e6).toFixed(1)} MB)`);
}

try {
  await copyWasm();
} catch (err) {
  console.warn(`[setup-assets] could not copy wasm runtime: ${err.message}. Falling back to CDN at runtime.`);
}
try {
  await downloadModel();
} catch (err) {
  console.warn(`[setup-assets] could not download hand model: ${err.message}. Falling back to CDN at runtime.`);
}
