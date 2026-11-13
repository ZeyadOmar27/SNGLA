import * as THREE from 'three';

export const TERRAIN_SCALE = 1.4;
export const TERRAIN_Y_OFFSET = -4.75 * TERRAIN_SCALE; // puts mare landing floor near y = 0
export const HADLEY_HALF_EXTENT = 127.75 * TERRAIN_SCALE;
export const HADLEY_PLAY_LIMIT = 140;

const STL_RAW_EDGE_CLIP = 127.35;
const CLEAN_UV_TILE = 16;
const GRID_RES = 512;

export interface FootprintSample {
  groundY: number;
  slopeDeg: number;
  normal: THREE.Vector3;
}

export interface TerrainSampler {
  getHeight: (x: number, z: number) => number;
  getNormal: (x: number, z: number, out?: THREE.Vector3) => THREE.Vector3;
  sampleFootprint: (x: number, z: number) => FootprintSample;
}

const PAD_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [2.3, 0],
  [-2.3, 0],
  [0, 2.3],
  [0, -2.3],
];

const _nTmp = new THREE.Vector3();

/**
 * Strips the 3D-printable STL bottom slab (y < 0.05) and outer vertical perimeter
 * sidewalls from the Hadley GLB mesh, flips upside-down terrain triangles so 100%
 * face upward (+Y), recomputes smooth vertex normals, generates uniform top-down
 * UVs, and paints geological lunar elevation/slope vertex colors.
 */
export function buildCleanHadleyGeometry(sourceGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const srcPos = sourceGeo.attributes.position;
  const srcIdx = sourceGeo.index;
  const triCount = srcIdx ? srcIdx.count / 3 : srcPos.count / 3;

  const vertRemap = new Int32Array(srcPos.count).fill(-1);
  const newPositions: number[] = [];
  const newUvs: number[] = [];
  const newIndices: number[] = [];
  const rawSpan = STL_RAW_EDGE_CLIP * 2;

  const mapVertex = (oldIdx: number): number => {
    const existing = vertRemap[oldIdx];
    if (existing !== -1) return existing;
    const x = srcPos.getX(oldIdx);
    const y = srcPos.getY(oldIdx);
    const z = srcPos.getZ(oldIdx);
    const next = newPositions.length / 3;
    newPositions.push(x, y, z);
    newUvs.push(
      ((x + STL_RAW_EDGE_CLIP) / rawSpan) * CLEAN_UV_TILE,
      ((z + STL_RAW_EDGE_CLIP) / rawSpan) * CLEAN_UV_TILE,
    );
    vertRemap[oldIdx] = next;
    return next;
  };

  for (let t = 0; t < triCount; t++) {
    const a = srcIdx ? srcIdx.getX(t * 3) : t * 3;
    const b = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const c = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;

    const ya = srcPos.getY(a);
    const yb = srcPos.getY(b);
    const yc = srcPos.getY(c);
    if (ya < 0.05 || yb < 0.05 || yc < 0.05) continue;

    const xa = srcPos.getX(a);
    const xb = srcPos.getX(b);
    const xc = srcPos.getX(c);
    const za = srcPos.getZ(a);
    const zb = srcPos.getZ(b);
    const zc = srcPos.getZ(c);
    if (
      Math.max(Math.abs(xa), Math.abs(xb), Math.abs(xc)) > STL_RAW_EDGE_CLIP ||
      Math.max(Math.abs(za), Math.abs(zb), Math.abs(zc)) > STL_RAW_EDGE_CLIP
    ) {
      continue;
    }

    const ax = xb - xa;
    const az = zb - za;
    const bx = xc - xa;
    const bz = zc - za;
    const ny = az * bx - ax * bz;
    if (Math.abs(ny) < 1e-8) continue;

    const na = mapVertex(a);
    const nb = mapVertex(b);
    const nc = mapVertex(c);

    // Ensure every kept terrain triangle is wound counter-clockwise when viewed from +Y
    if (ny < 0) {
      newIndices.push(na, nc, nb);
    } else {
      newIndices.push(na, nb, nc);
    }
  }

  const cleanGeo = new THREE.BufferGeometry();
  cleanGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  cleanGeo.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
  cleanGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  cleanGeo.computeVertexNormals();

  // Subtle lunar geology vertex shading: darker basaltic mare/rille floors, brighter highlands
  const normAttr = cleanGeo.attributes.normal;
  const posAttr = cleanGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const worldY = posAttr.getY(i) * TERRAIN_SCALE + TERRAIN_Y_OFFSET;
    const ny = THREE.MathUtils.clamp(normAttr.getY(i), 0, 1);
    const slope = 1 - ny;

    const elevT = THREE.MathUtils.clamp((worldY + 1.5) / 22, 0, 1);
    const shade = THREE.MathUtils.clamp(0.78 + elevT * 0.19 + slope * 0.14, 0.72, 1.0);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = Math.min(1, shade * 1.02);
  }
  cleanGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  cleanGeo.computeBoundingSphere();

  return cleanGeo;
}

function squareBorderPoint(theta: number, halfExtent: number): [number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const scale = halfExtent / Math.max(Math.abs(c), Math.abs(s));
  return [c * scale, s * scale];
}

/**
 * Builds an outer lunar regolith horizon apron extending seamlessly from the outer
 * border of the Hadley terrain patch out to 900m so the horizon has no box cutoff.
 */
export function buildHorizonApronGeometry(sampler: TerrainSampler): THREE.BufferGeometry {
  const segments = 144;
  const rings = [0, 0.08, 0.22, 0.45, 0.72, 1.0];
  const innerHalf = (STL_RAW_EDGE_CLIP - 0.5) * TERRAIN_SCALE;
  const outerRadius = 900;
  const mareSpan = STL_RAW_EDGE_CLIP * 2 * TERRAIN_SCALE;

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let rIdx = 0; rIdx < rings.length; rIdx++) {
    const t = rings[rIdx];
    const smoothT = t * t * (3 - 2 * t);
    for (let sIdx = 0; sIdx <= segments; sIdx++) {
      const theta = (sIdx / segments) * Math.PI * 2;
      const [bx, bz] = squareBorderPoint(theta, innerHalf);
      const borderH = sampler.getHeight(bx, bz);

      const dirLen = Math.hypot(bx, bz) || 1;
      const ux = bx / dirLen;
      const uz = bz / dirLen;

      const x = THREE.MathUtils.lerp(bx, ux * outerRadius, t);
      const z = THREE.MathUtils.lerp(bz, uz * outerRadius, t);
      const undulation = Math.sin(theta * 5) * 1.6 + Math.cos(theta * 9) * 0.9;
      const farY = -0.6 + undulation * (1 - t * 0.6);
      const y = THREE.MathUtils.lerp(borderH - 0.04, farY, smoothT);

      positions.push(x, y, z);
      uvs.push((x / mareSpan) * CLEAN_UV_TILE, (z / mareSpan) * CLEAN_UV_TILE);

      const shade = THREE.MathUtils.lerp(0.84, 0.76, t);
      colors.push(shade, shade, Math.min(1, shade * 1.02));
    }
  }

  const rowStride = segments + 1;
  for (let rIdx = 0; rIdx < rings.length - 1; rIdx++) {
    for (let sIdx = 0; sIdx < segments; sIdx++) {
      const a = rIdx * rowStride + sIdx;
      const b = a + 1;
      const c = (rIdx + 1) * rowStride + sIdx;
      const d = c + 1;

      const pushUpTri = (i0: number, i1: number, i2: number) => {
        const x0 = positions[i0 * 3];
        const z0 = positions[i0 * 3 + 2];
        const x1 = positions[i1 * 3];
        const z1 = positions[i1 * 3 + 2];
        const x2 = positions[i2 * 3];
        const z2 = positions[i2 * 3 + 2];
        const ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
        if (ny < 0) indices.push(i0, i2, i1);
        else indices.push(i0, i1, i2);
      };

      pushUpTri(a, c, b);
      pushUpTri(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Rasterizes the cleaned Apollo 15 Landing Site GLB surface into a fast O(1)
 * bilinear height grid so rendering and physics stay 100% identical.
 */
export function buildTerrainSampler(geometry: THREE.BufferGeometry): TerrainSampler {
  const pos = geometry.attributes.position;
  const idx = geometry.index;

  const validHalf = STL_RAW_EDGE_CLIP * TERRAIN_SCALE;
  const minBound = -validHalf;
  const span = validHalf * 2;
  const cellSize = span / (GRID_RES - 1);

  const grid = new Float32Array(GRID_RES * GRID_RES);
  grid.fill(-Infinity);

  const triCount = idx ? idx.count / 3 : pos.count / 3;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

    const x0 = pos.getX(i0) * TERRAIN_SCALE;
    const y0 = pos.getY(i0) * TERRAIN_SCALE + TERRAIN_Y_OFFSET;
    const z0 = pos.getZ(i0) * TERRAIN_SCALE;

    const x1 = pos.getX(i1) * TERRAIN_SCALE;
    const y1 = pos.getY(i1) * TERRAIN_SCALE + TERRAIN_Y_OFFSET;
    const z1 = pos.getZ(i1) * TERRAIN_SCALE;

    const x2 = pos.getX(i2) * TERRAIN_SCALE;
    const y2 = pos.getY(i2) * TERRAIN_SCALE + TERRAIN_Y_OFFSET;
    const z2 = pos.getZ(i2) * TERRAIN_SCALE;

    const denom = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(denom) < 1e-7) continue;

    const gxMin = Math.max(0, Math.floor((Math.min(x0, x1, x2) - minBound) / cellSize));
    const gxMax = Math.min(GRID_RES - 1, Math.ceil((Math.max(x0, x1, x2) - minBound) / cellSize));
    const gzMin = Math.max(0, Math.floor((Math.min(z0, z1, z2) - minBound) / cellSize));
    const gzMax = Math.min(GRID_RES - 1, Math.ceil((Math.max(z0, z1, z2) - minBound) / cellSize));

    for (let gz = gzMin; gz <= gzMax; gz++) {
      const pz = minBound + gz * cellSize;
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const px = minBound + gx * cellSize;

        const w0 = ((z1 - z2) * (px - x2) + (x2 - x1) * (pz - z2)) / denom;
        const w1 = ((z2 - z0) * (px - x2) + (x0 - x2) * (pz - z2)) / denom;
        const w2 = 1 - w0 - w1;

        if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) {
          const h = w0 * y0 + w1 * y1 + w2 * y2;
          const cell = gz * GRID_RES + gx;
          if (h > grid[cell]) grid[cell] = h;
        }
      }
    }
  }

  // Fill any unhit boundary cells smoothly from nearest neighbors
  for (let gz = 0; gz < GRID_RES; gz++) {
    for (let gx = 0; gx < GRID_RES; gx++) {
      const cell = gz * GRID_RES + gx;
      if (grid[cell] === -Infinity) {
        if (gx > 0 && grid[cell - 1] !== -Infinity) grid[cell] = grid[cell - 1];
        else if (gz > 0 && grid[cell - GRID_RES] !== -Infinity) grid[cell] = grid[cell - GRID_RES];
        else grid[cell] = 0;
      }
    }
  }
  for (let gz = GRID_RES - 1; gz >= 0; gz--) {
    for (let gx = GRID_RES - 1; gx >= 0; gx--) {
      const cell = gz * GRID_RES + gx;
      if (grid[cell] === 0 && gx < GRID_RES - 1 && grid[cell + 1] !== 0) {
        grid[cell] = grid[cell + 1];
      }
    }
  }

  const getHeight = (x: number, z: number): number => {
    const u = THREE.MathUtils.clamp((x - minBound) / cellSize, 1, GRID_RES - 2.0001);
    const v = THREE.MathUtils.clamp((z - minBound) / cellSize, 1, GRID_RES - 2.0001);
    const gx = Math.floor(u);
    const gz = Math.floor(v);
    const fx = u - gx;
    const fz = v - gz;

    const h00 = grid[gz * GRID_RES + gx];
    const h10 = grid[gz * GRID_RES + gx + 1];
    const h01 = grid[(gz + 1) * GRID_RES + gx];
    const h11 = grid[(gz + 1) * GRID_RES + gx + 1];

    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  };

  const getNormal = (x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 => {
    const eps = 0.7;
    const hL = getHeight(x - eps, z);
    const hR = getHeight(x + eps, z);
    const hD = getHeight(x, z - eps);
    const hU = getHeight(x, z + eps);
    return out.set(hL - hR, 2 * eps, hD - hU).normalize();
  };

  const sampleFootprint = (x: number, z: number): FootprintSample => {
    const centerY = getHeight(x, z);
    const padHeights = PAD_OFFSETS.map(([ox, oz]) => getHeight(x + ox, z + oz));
    const avgPadY = padHeights.reduce((sum, y) => sum + y, 0) / padHeights.length;
    const maxPadY = Math.max(...padHeights);

    const fittedNormal = new THREE.Vector3(
      padHeights[1] - padHeights[0],
      4.6,
      padHeights[3] - padHeights[2],
    ).normalize();

    const centerNormal = getNormal(x, z, _nTmp);
    const combinedNormal = fittedNormal.clone().lerp(centerNormal, 0.35).normalize();

    const padSlopeDeg = THREE.MathUtils.radToDeg(
      Math.acos(THREE.MathUtils.clamp(fittedNormal.y, -1, 1)),
    );
    const centerSlopeDeg = THREE.MathUtils.radToDeg(
      Math.acos(THREE.MathUtils.clamp(centerNormal.y, -1, 1)),
    );

    return {
      groundY: Math.max(centerY, avgPadY * 0.7 + maxPadY * 0.3 - 0.12),
      slopeDeg: Math.max(padSlopeDeg, centerSlopeDeg),
      normal: combinedNormal,
    };
  };

  return { getHeight, getNormal, sampleFootprint };
}

const EXPLORATION_SITE_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [-48, -48],
  [20, -45],
  [-55, -10],
];

/**
 * Picks a flat mare Exploration Site 1 waypoint far enough from Falcon basecamp
 * for an engaging lunar rover traverse across Hadley Plain.
 */
export function pickExplorationSite(
  lmX: number,
  lmZ: number,
  sampler: TerrainSampler,
): THREE.Vector3 {
  let chosen = EXPLORATION_SITE_CANDIDATES[0];
  let bestDist = -1;
  for (const cand of EXPLORATION_SITE_CANDIDATES) {
    const d = Math.hypot(cand[0] - lmX, cand[1] - lmZ);
    if (d >= 42) {
      chosen = cand;
      break;
    }
    if (d > bestDist) {
      bestDist = d;
      chosen = cand;
    }
  }
  return new THREE.Vector3(chosen[0], sampler.getHeight(chosen[0], chosen[1]), chosen[1]);
}
