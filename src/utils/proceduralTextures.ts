import * as THREE from 'three';

function hash2D(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Seamless periodic value noise over [0, period) × [0, period). */
function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;

  const n00 = hash2D(ix0, iy0, seed);
  const n10 = hash2D(ix1, iy0, seed);
  const n01 = hash2D(ix0, iy1, seed);
  const n11 = hash2D(ix1, iy1, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function periodicFbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = basePeriod;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * periodicNoise(u, v, freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

function configureTexture(
  canvas: HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  isColor: boolean,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 16;
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let cachedFoilBump: THREE.CanvasTexture | null = null;
let cachedMetalBump: THREE.CanvasTexture | null = null;
let cachedLunarMaps: {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} | null = null;

/** Seamless crinkled-ridge texture simulating Apollo Kapton thermal foil. */
export function getFoilBumpTexture(): THREE.CanvasTexture {
  if (cachedFoilBump) return cachedFoilBump;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Ridge/triangle fold noise for sharp foil creases softened by higher octaves
      const n1 = Math.abs(periodicFbm(u, v, 6, 4, 11) * 2 - 1);
      const n2 = Math.abs(periodicFbm(u + 0.37, v + 0.19, 12, 3, 53) * 2 - 1);
      const val = Math.max(0, Math.min(255, Math.round((1 - (n1 * 0.65 + n2 * 0.35)) * 255)));
      const idx = (y * size + x) * 4;
      img.data[idx] = val;
      img.data[idx + 1] = val;
      img.data[idx + 2] = val;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cachedFoilBump = configureTexture(canvas, 4, 4, false);
  return cachedFoilBump;
}

/** Fine aerospace metal micro-grain texture. */
export function getMicroGrainTexture(): THREE.CanvasTexture {
  if (cachedMetalBump) return cachedMetalBump;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const fine = periodicFbm(u, v, 16, 3, 97);
      const streak = periodicNoise(u, v * 0.25, 32, 131);
      const val = Math.round((fine * 0.65 + streak * 0.35) * 255);
      const idx = (y * size + x) * 4;
      img.data[idx] = val;
      img.data[idx + 1] = val;
      img.data[idx + 2] = val;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cachedMetalBump = configureTexture(canvas, 6, 6, false);
  return cachedMetalBump;
}

/** Seamless lunar regolith albedo, bump, and roughness textures for the plank. */
export function getLunarPlankTextures() {
  if (cachedLunarMaps) return cachedLunarMaps;

  const size = 512;
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = roughCanvas.width = size;
  colorCanvas.height = bumpCanvas.height = roughCanvas.height = size;

  const colorCtx = colorCanvas.getContext('2d')!;
  const bumpCtx = bumpCanvas.getContext('2d')!;
  const roughCtx = roughCanvas.getContext('2d')!;

  const colorImg = colorCtx.createImageData(size, size);
  const bumpImg = bumpCtx.createImageData(size, size);
  const roughImg = roughCtx.createImageData(size, size);

  // Pre-generate seamless micro-craters (wrapped across tile borders)
  const craters = Array.from({ length: 28 }, (_, i) => ({
    cx: hash2D(i, 1, 301),
    cy: hash2D(i, 2, 301),
    r: 0.018 + hash2D(i, 3, 301) * 0.045,
    depth: 0.28 + hash2D(i, 4, 301) * 0.35,
  }));

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const macro = periodicFbm(u, v, 4, 4, 7);
      const grain = periodicFbm(u, v, 32, 3, 71);
      const grit = hash2D(x, y, 19);

      let craterDelta = 0;
      for (const c of craters) {
        let dx = Math.abs(u - c.cx);
        let dy = Math.abs(v - c.cy);
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const d = Math.hypot(dx, dy) / c.r;
        if (d < 1.35) {
          if (d < 0.85) {
            // Bowl depression
            const t = d / 0.85;
            craterDelta -= c.depth * (1 - t * t);
          } else {
            // Subtle raised rim
            const t = (d - 0.85) / 0.5;
            craterDelta += c.depth * 0.25 * Math.sin(t * Math.PI);
          }
        }
      }

      const height = Math.max(0, Math.min(1, 0.52 + (macro - 0.5) * 0.45 + (grain - 0.5) * 0.25 + (grit - 0.5) * 0.1 + craterDelta * 0.5));

      // Neutral lunar gray-slate palette (#4e5259 .. #8d9198)
      const baseLum = Math.round(78 + height * 68 + (grit - 0.5) * 14);
      const r = Math.max(0, Math.min(255, baseLum + 2));
      const g = Math.max(0, Math.min(255, baseLum + 1));
      const b = Math.max(0, Math.min(255, baseLum - 2));

      const bumpByte = Math.round(height * 255);
      // Very high roughness (0.86..0.99) for dusty regolith
      const roughByte = Math.round((0.86 + (1 - height) * 0.12) * 255);

      const idx = (y * size + x) * 4;
      colorImg.data[idx] = r;
      colorImg.data[idx + 1] = g;
      colorImg.data[idx + 2] = b;
      colorImg.data[idx + 3] = 255;

      bumpImg.data[idx] = bumpByte;
      bumpImg.data[idx + 1] = bumpByte;
      bumpImg.data[idx + 2] = bumpByte;
      bumpImg.data[idx + 3] = 255;

      roughImg.data[idx] = roughByte;
      roughImg.data[idx + 1] = roughByte;
      roughImg.data[idx + 2] = roughByte;
      roughImg.data[idx + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  bumpCtx.putImageData(bumpImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  cachedLunarMaps = {
    map: configureTexture(colorCanvas, 4, 4.5, true),
    bumpMap: configureTexture(bumpCanvas, 4, 4.5, false),
    roughnessMap: configureTexture(roughCanvas, 4, 4.5, false),
  };
  return cachedLunarMaps;
}

