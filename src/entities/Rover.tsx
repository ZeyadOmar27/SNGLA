import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import roverUrl from '@assets/lunar_Rover.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { HADLEY_PLAY_LIMIT, type TerrainSampler } from '../utils/hadleyTerrain';
import { LUNAR_ROCK_SPECS, type LunarRockKind } from '../utils/lunarRocks';
import type { WorldRockSite } from './LunarRocks';
import { LM_HALF_EXTENT } from './LunarModule';
import { LunarDust } from './LunarDust';
import { playSwitchClickSfx } from '../utils/lunarSfx';

export type LrvSteeringMode = 'dual' | 'front' | 'rear';
export type LrvDriveState = 'FWD' | 'NEUTRAL' | 'BRAKE' | 'REV';

export interface DriveTelemetry {
  speed: number;
  distanceToSite: number;
  targetLabel: string;
  headingDeg: number;
  targetBearingDeg: number;
  reachedSite: boolean;
  nearbyRockId: LunarRockKind | null;
  steeringMode: LrvSteeringMode;
  driveState: LrvDriveState;
  tBarPitch: number;
  tBarSteer: number;
}

export interface RoverProps {
  sampler: TerrainSampler;
  spawnPos: THREE.Vector3;
  initialHeading: number;
  lmPos: THREE.Vector3;
  rockSites: readonly WorldRockSite[];
  collectedSet: ReadonlySet<LunarRockKind>;
  grabSwingNonce: number;
  steeringMode: LrvSteeringMode;
  onCycleSteeringMode: () => void;
  roverPosRefOut: React.MutableRefObject<THREE.Vector3>;
  resetNonce: number;
  onDriveUpdate: (telemetry: DriveTelemetry) => void;
}

const CAMERA_FOV = 66;
const MAX_SPEED = 11.5;
const REVERSE_SPEED = 4.8;
const ACCEL = 15;
const DRAG = 4.2;
const TURN_RATE = 1.9;
const COLLISION_RADIUS = LM_HALF_EXTENT + 1.4;
const ROCK_GRAB_RANGE = 6.2;
const MAX_DRIVABLE_SLOPE_DEG = 34;
const MAX_WHEEL_STEER = 0.48;
const WHEEL_WORLD_RADIUS = 0.332;

interface WheelPivotRig {
  steerGroup: THREE.Group;
  spinGroup: THREE.Group;
  isFront: boolean;
  isLeft: boolean;
  rollAngle: number;
}

const WHEEL_QUADRANTS = [
  { key: 'fl', isFront: true, isLeft: true, test: (x: number, z: number) => x >= 0 && z < 0 },
  { key: 'fr', isFront: true, isLeft: false, test: (x: number, z: number) => x >= 0 && z >= 0 },
  { key: 'rl', isFront: false, isLeft: true, test: (x: number, z: number) => x < 0 && z < 0 },
  { key: 'rr', isFront: false, isLeft: false, test: (x: number, z: number) => x < 0 && z >= 0 },
] as const;

function hasMaterialNamed(mat: THREE.Material | THREE.Material[], needle: string): boolean {
  if (Array.isArray(mat)) return mat.some((m) => m.name.toLowerCase().includes(needle));
  return mat.name.toLowerCase().includes(needle);
}

/**
 * Merges coincident seam vertices and triangle edges to label connected geometry islands.
 */
function buildTopologyUnionFind(srcGeo: THREE.BufferGeometry): (vertIdx: number) => number {
  const pos = srcGeo.attributes.position;
  const idx = srcGeo.index;
  const count = pos.count;

  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const posMap = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(pos.getX(i) * 10)},${Math.round(pos.getY(i) * 10)},${Math.round(pos.getZ(i) * 10)}`;
    const existing = posMap.get(key);
    if (existing !== undefined) unite(existing, i);
    else posMap.set(key, i);
  }

  const triCount = idx ? idx.count / 3 : count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    unite(a, b);
    unite(a, c);
  }

  return find;
}

function createBrownUvTester(
  mat: THREE.Material | THREE.Material[],
): (u: number, v: number) => boolean {
  const firstMat = Array.isArray(mat) ? mat[0] : mat;
  const map = firstMat instanceof THREE.MeshStandardMaterial ? firstMat.map : null;
  const img = map?.image as CanvasImageSource | undefined;
  if (!map || !img || typeof document === 'undefined') return () => false;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => false;

  try {
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const flipY = map.flipY;

    return (u: number, v: number) => {
      const uNorm = ((u % 1) + 1) % 1;
      const vNorm = ((v % 1) + 1) % 1;
      const px = Math.min(size - 1, Math.max(0, Math.round(uNorm * (size - 1))));
      const py = Math.min(
        size - 1,
        Math.max(0, Math.round((flipY ? 1 - vNorm : vNorm) * (size - 1))),
      );
      const idx = (py * size + px) * 4;
      return data[idx] > data[idx + 2] * 1.25 && data[idx] > 70;
    };
  } catch {
    return () => false;
  }
}

/**
 * Flags each vertex belonging to a brown fender island (separated from the lower
 * rotating tire/hub components via Union-Find across triangle & seam topology).
 */
function markFenderVertices(
  srcGeo: THREE.BufferGeometry,
  isBrownUv: (u: number, v: number) => boolean,
): Uint8Array {
  const pos = srcGeo.attributes.position;
  const uv = srcGeo.attributes.uv;
  const count = pos.count;
  const isFender = new Uint8Array(count);
  if (!uv) return isFender;

  const find = buildTopologyUnionFind(srcGeo);

  const compStats = new Map<number, { hasBrown: boolean; minY: number }>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    let st = compStats.get(root);
    if (!st) {
      st = { hasBrown: false, minY: Infinity };
      compStats.set(root, st);
    }
    const y = pos.getY(i);
    if (y < st.minY) st.minY = y;
    if (!st.hasBrown && isBrownUv(uv.getX(i), uv.getY(i))) {
      st.hasBrown = true;
    }
  }

  for (let i = 0; i < count; i++) {
    const st = compStats.get(find(i));
    if (st && st.hasBrown && st.minY > 24) {
      isFender[i] = 1;
    }
  }
  return isFender;
}

function extractTriSubsetGeometry(
  srcGeo: THREE.BufferGeometry,
  triIndices: number[],
  centerOffset: THREE.Vector3,
): THREE.BufferGeometry | null {
  if (triIndices.length === 0) return null;
  const srcPos = srcGeo.attributes.position;
  const remap = new Int32Array(srcPos.count).fill(-1);
  const oldVertOrder: number[] = [];
  const newIndices = new Uint32Array(triIndices.length);

  for (let i = 0; i < triIndices.length; i++) {
    const oldV = triIndices[i];
    let mapped = remap[oldV];
    if (mapped === -1) {
      mapped = oldVertOrder.length;
      remap[oldV] = mapped;
      oldVertOrder.push(oldV);
    }
    newIndices[i] = mapped;
  }

  const subGeo = new THREE.BufferGeometry();
  for (const attrName of Object.keys(srcGeo.attributes)) {
    const srcAttr = srcGeo.attributes[attrName];
    const itemSize = srcAttr.itemSize;
    const arr = new Float32Array(oldVertOrder.length * itemSize);
    for (let k = 0; k < oldVertOrder.length; k++) {
      const oldIdx = oldVertOrder[k];
      if (attrName === 'position') {
        arr[k * 3] = srcPos.getX(oldIdx) - centerOffset.x;
        arr[k * 3 + 1] = srcPos.getY(oldIdx) - centerOffset.y;
        arr[k * 3 + 2] = srcPos.getZ(oldIdx) - centerOffset.z;
      } else {
        for (let c = 0; c < itemSize; c++) {
          arr[k * itemSize + c] = srcAttr.array[oldIdx * itemSize + c];
        }
      }
    }
    subGeo.setAttribute(attrName, new THREE.BufferAttribute(arr, itemSize, srcAttr.normalized));
  }

  subGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));
  subGeo.computeBoundingBox();
  subGeo.computeBoundingSphere();
  return subGeo;
}

/**
 * Separates the central LRV T-bar hand controller between the seats from the
 * ControlPanel mesh so it tilts dynamically forward/back/left/right as you drive.
 */
function buildTBarControllerRig(root: THREE.Object3D): THREE.Group | null {
  const panelMeshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.material && hasMaterialNamed(m.material, 'controlpanel')) {
      panelMeshes.push(m);
    }
  });

  for (const mesh of panelMeshes) {
    const srcGeo = mesh.geometry;
    const pos = srcGeo.attributes.position;
    const idx = srcGeo.index;
    const find = buildTopologyUnionFind(srcGeo);

    const compBoxes = new Map<number, THREE.Box3>();
    const pt = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const r = find(i);
      let box = compBoxes.get(r);
      if (!box) {
        box = new THREE.Box3();
        compBoxes.set(r, box);
      }
      box.expandByPoint(pt.set(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }

    const tBarRoots = new Set<number>();
    const tBarBox = new THREE.Box3();
    for (const [r, box] of compBoxes) {
      if (
        box.min.x >= -21.2 &&
        box.max.x <= -13.8 &&
        box.min.y >= 76.6 &&
        box.max.y <= 88.6 &&
        box.min.z >= -5.4 &&
        box.max.z <= 6.6
      ) {
        tBarRoots.add(r);
        tBarBox.union(box);
      }
    }

    if (tBarRoots.size === 0 || tBarBox.isEmpty()) continue;

    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const tBarTris: number[] = [];
    const consoleTris: number[] = [];

    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      if (tBarRoots.has(find(a)) && tBarRoots.has(find(b)) && tBarRoots.has(find(c))) {
        tBarTris.push(a, b, c);
      } else {
        consoleTris.push(a, b, c);
      }
    }

    if (tBarTris.length === 0) continue;

    const pivot = new THREE.Vector3(
      (tBarBox.min.x + tBarBox.max.x) * 0.5,
      tBarBox.min.y + 0.6,
      (tBarBox.min.z + tBarBox.max.z) * 0.5,
    );
    const tBarGeo = extractTriSubsetGeometry(srcGeo, tBarTris, pivot);
    if (!tBarGeo) continue;

    const tBarGroup = new THREE.Group();
    tBarGroup.name = 'lrv_tbar_stick';
    tBarGroup.position.copy(pivot);
    const tBarMesh = new THREE.Mesh(tBarGeo, mesh.material);
    tBarMesh.castShadow = true;
    tBarMesh.receiveShadow = true;
    tBarGroup.add(tBarMesh);
    (mesh.parent ?? root).add(tBarGroup);

    const remainingGeo = extractTriSubsetGeometry(srcGeo, consoleTris, new THREE.Vector3());
    if (remainingGeo) {
      mesh.geometry = remainingGeo;
    }

    return tBarGroup;
  }

  return null;
}

/**
 * Separates stationary orange-brown fenders from the rotating tires/hubs inside
 * the merged `Wheels` GLB meshes, then pivots each corner tire around its true axle.
 */
function buildSplitWheelRigs(root: THREE.Object3D): WheelPivotRig[] {
  const wheelMeshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.material && hasMaterialNamed(m.material, 'wheel')) {
      wheelMeshes.push(m);
    }
  });
  if (wheelMeshes.length === 0) return [];

  const wheelParent = wheelMeshes[0].parent ?? root;
  const isBrownUv = createBrownUvTester(wheelMeshes[0].material);
  const fenderGroup = new THREE.Group();
  fenderGroup.name = 'rover_fenders_static';
  const zeroOffset = new THREE.Vector3();

  const perMeshData = wheelMeshes.map((mesh) => {
    const isFenderVert = markFenderVertices(mesh.geometry, isBrownUv);
    return { mesh, isFenderVert };
  });

  // Compute tire-only bounds (excluding upper brown fenders) for true axle centering
  const boxes = WHEEL_QUADRANTS.map(() => new THREE.Box3());
  const tmpPt = new THREE.Vector3();
  for (const { mesh, isFenderVert } of perMeshData) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (isFenderVert[i]) continue;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      for (let q = 0; q < WHEEL_QUADRANTS.length; q++) {
        if (WHEEL_QUADRANTS[q].test(x, z)) {
          boxes[q].expandByPoint(tmpPt.set(x, y, z));
          break;
        }
      }
    }
  }

  // Keep stationary brown fenders anchored to the rover chassis/suspension
  for (const { mesh, isFenderVert } of perMeshData) {
    const srcGeo = mesh.geometry;
    const srcIdx = srcGeo.index;
    const triCount = srcIdx ? srcIdx.count / 3 : srcGeo.attributes.position.count / 3;
    const fenderTris: number[] = [];

    for (let t = 0; t < triCount; t++) {
      const a = srcIdx ? srcIdx.getX(t * 3) : t * 3;
      const b = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
      const c = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
      if (isFenderVert[a] || isFenderVert[b] || isFenderVert[c]) {
        fenderTris.push(a, b, c);
      }
    }

    const fenderGeo = extractTriSubsetGeometry(srcGeo, fenderTris, zeroOffset);
    if (fenderGeo) {
      const fenderMesh = new THREE.Mesh(fenderGeo, mesh.material);
      fenderMesh.castShadow = true;
      fenderMesh.receiveShadow = true;
      fenderGroup.add(fenderMesh);
    }
  }
  wheelParent.add(fenderGroup);

  const rigs: WheelPivotRig[] = [];
  for (let q = 0; q < WHEEL_QUADRANTS.length; q++) {
    if (boxes[q].isEmpty()) continue;
    const center = boxes[q].getCenter(new THREE.Vector3());
    const steerGroup = new THREE.Group();
    steerGroup.name = `wheel_steer_${WHEEL_QUADRANTS[q].key}`;
    steerGroup.position.copy(center);

    const spinGroup = new THREE.Group();
    spinGroup.name = `wheel_spin_${WHEEL_QUADRANTS[q].key}`;
    steerGroup.add(spinGroup);

    for (const { mesh, isFenderVert } of perMeshData) {
      const srcGeo = mesh.geometry;
      const srcPos = srcGeo.attributes.position;
      const srcIdx = srcGeo.index;
      const triCount = srcIdx ? srcIdx.count / 3 : srcPos.count / 3;
      const wheelTris: number[] = [];

      for (let t = 0; t < triCount; t++) {
        const a = srcIdx ? srcIdx.getX(t * 3) : t * 3;
        const b = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
        const c = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
        if (isFenderVert[a] || isFenderVert[b] || isFenderVert[c]) continue;

        const cx = (srcPos.getX(a) + srcPos.getX(b) + srcPos.getX(c)) / 3;
        const cz = (srcPos.getZ(a) + srcPos.getZ(b) + srcPos.getZ(c)) / 3;
        if (WHEEL_QUADRANTS[q].test(cx, cz)) {
          wheelTris.push(a, b, c);
        }
      }

      const partGeo = extractTriSubsetGeometry(srcGeo, wheelTris, center);
      if (partGeo) {
        const partMesh = new THREE.Mesh(partGeo, mesh.material);
        partMesh.castShadow = true;
        partMesh.receiveShadow = true;
        spinGroup.add(partMesh);
      }
    }

    wheelParent.add(steerGroup);
    rigs.push({
      steerGroup,
      spinGroup,
      isFront: WHEEL_QUADRANTS[q].isFront,
      isLeft: WHEEL_QUADRANTS[q].isLeft,
      rollAngle: 0,
    });
  }

  for (const oldMesh of wheelMeshes) {
    oldMesh.parent?.remove(oldMesh);
  }

  return rigs;
}

export function Rover({
  sampler,
  spawnPos,
  initialHeading,
  lmPos,
  rockSites,
  collectedSet,
  grabSwingNonce,
  steeringMode,
  onCycleSteeringMode,
  roverPosRefOut,
  resetNonce,
  onDriveUpdate,
}: RoverProps) {
  const { scene } = useGLTF(roverUrl);
  const { gl, camera } = useThree();

  const roverGroupRef = useRef<THREE.Group>(null);
  const suspensionGroupRef = useRef<THREE.Group>(null);
  const tongsArmRef = useRef<THREE.Group>(null);
  const tongsJawLeftRef = useRef<THREE.Mesh>(null);
  const tongsJawRightRef = useRef<THREE.Mesh>(null);

  const posRef = useRef(spawnPos.clone());
  const headingRef = useRef(initialHeading);
  const speedRef = useRef(0);
  const frontSteerRef = useRef(0);
  const rearSteerRef = useRef(0);
  const tBarPitchRef = useRef(0);
  const tBarSteerRef = useRef(0);
  const suspPitchRef = useRef(0);
  const suspRollRef = useRef(0);
  const suspHeaveRef = useRef(0);
  const suspHeaveVelRef = useRef(0);
  const prevGroundYRef = useRef(spawnPos.y);
  const reverseLatchedRef = useRef(false);
  const reverseHoldTimerRef = useRef(0);
  const reverseStartedStoppedRef = useRef(true);
  const prevDriveStateRef = useRef<LrvDriveState>('NEUTRAL');
  const prevSteeringModeRef = useRef<LrvSteeringMode>(steeringMode);
  const steeringModeRef = useRef<LrvSteeringMode>(steeringMode);
  const onCycleSteeringRef = useRef(onCycleSteeringMode);
  steeringModeRef.current = steeringMode;
  onCycleSteeringRef.current = onCycleSteeringMode;

  const smoothNormalRef = useRef(new THREE.Vector3(0, 1, 0));
  const camPosRef = useRef(new THREE.Vector3());
  const camLookRef = useRef(new THREE.Vector3());
  const zoomRef = useRef(1);
  const keysRef = useRef<Record<string, boolean>>({});
  const telemetryTimerRef = useRef(0);
  const swingProgressRef = useRef<number | null>(null);
  const prevNearbyRef = useRef<LunarRockKind | null>(null);

  const tmpNormal = useMemo(() => new THREE.Vector3(), []);
  const tmpRight = useMemo(() => new THREE.Vector3(), []);
  const tmpFwdFlat = useMemo(() => new THREE.Vector3(), []);
  const tmpZAxis = useMemo(() => new THREE.Vector3(), []);
  const tmpBasis = useMemo(() => new THREE.Matrix4(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpDesiredCam = useMemo(() => new THREE.Vector3(), []);
  const tmpDesiredLook = useMemo(() => new THREE.Vector3(), []);

  const { preparedRover, wheelRigs, tBarRig } = useMemo(() => {
    const model = prepareAndSoftenModel(scene, {
      targetSize: 2.8,
      maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
    });
    const rigs = buildSplitWheelRigs(model);
    const tBar = buildTBarControllerRig(model);
    return { preparedRover: model, wheelRigs: rigs, tBarRig: tBar };
  }, [scene, gl]);

  // Trigger 3D tongs extension/chomp animation whenever player takes a grab swing
  useEffect(() => {
    if (grabSwingNonce > 0) {
      swingProgressRef.current = 0;
    }
  }, [grabSwingNonce]);

  const pickActiveTarget = (rx: number, rz: number) => {
    let bestSite: WorldRockSite | null = null;
    let bestDist = Infinity;
    for (const s of rockSites) {
      if (collectedSet.has(s.spec.id)) continue;
      const d = Math.hypot(s.position.x - rx, s.position.z - rz);
      if (d < bestDist) {
        bestDist = d;
        bestSite = s;
      }
    }
    return { bestSite, bestDist };
  };

  const resetLrvKinematics = (groundY: number) => {
    posRef.current.set(spawnPos.x, groundY, spawnPos.z);
    roverPosRefOut.current.copy(posRef.current);
    headingRef.current = initialHeading;
    speedRef.current = 0;
    frontSteerRef.current = 0;
    rearSteerRef.current = 0;
    tBarPitchRef.current = 0;
    tBarSteerRef.current = 0;
    suspPitchRef.current = 0;
    suspRollRef.current = 0;
    suspHeaveRef.current = 0;
    suspHeaveVelRef.current = 0;
    prevGroundYRef.current = groundY;
    reverseLatchedRef.current = false;
    reverseHoldTimerRef.current = 0;
    for (const rig of wheelRigs) rig.rollAngle = 0;
    sampler.getNormal(spawnPos.x, spawnPos.z, smoothNormalRef.current);
  };

  // Initialize / reset rover cleanly at open lunar mare spawn point
  useEffect(() => {
    const groundY = sampler.getHeight(spawnPos.x, spawnPos.z);
    resetLrvKinematics(groundY);
    prevNearbyRef.current = null;

    const fwdX = -Math.sin(initialHeading);
    const fwdZ = -Math.cos(initialHeading);
    camPosRef.current.set(spawnPos.x - fwdX * 7.6, groundY + 3.4, spawnPos.z - fwdZ * 7.6);
    camLookRef.current.set(spawnPos.x + fwdX * 3.5, groundY + 1.0, spawnPos.z + fwdZ * 3.5);
    camera.position.copy(camPosRef.current);
    camera.lookAt(camLookRef.current);

    if (roverGroupRef.current) {
      roverGroupRef.current.position.copy(posRef.current);
    }
  }, [sampler, spawnPos, initialHeading, resetNonce, camera, roverPosRefOut, wheelRigs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.code === 'KeyS' || e.code === 'ArrowDown') && !e.repeat) {
        reverseStartedStoppedRef.current = Math.abs(speedRef.current) <= 0.12;
      }
      keysRef.current[e.code] = true;
      if (e.code === 'KeyR') {
        resetLrvKinematics(sampler.getHeight(spawnPos.x, spawnPos.z));
      } else if (e.code === 'KeyQ' && !e.repeat) {
        playSwitchClickSfx();
        onCycleSteeringRef.current();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    const clearKeys = () => {
      keysRef.current = {};
    };
    const onWheel = (e: WheelEvent) => {
      zoomRef.current = THREE.MathUtils.clamp(zoomRef.current + e.deltaY * 0.0008, 0.55, 1.8);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      window.removeEventListener('wheel', onWheel);
    };
  }, [sampler, spawnPos, initialHeading, roverPosRefOut]);

  useFrame((_, rawDelta) => {
    const group = roverGroupRef.current;
    if (!group) return;

    const dt = Math.min(rawDelta, 0.05);

    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - CAMERA_FOV) > 0.1) {
      camera.fov = CAMERA_FOV;
      camera.updateProjectionMatrix();
    }

    const keys = keysRef.current;
    const throttle =
      (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) -
      (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    const steer =
      (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) -
      (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);

    const prevSpeed = speedRef.current;
    let speed = prevSpeed;
    let driveState: LrvDriveState = Math.abs(speed) < 0.08 ? 'NEUTRAL' : speed > 0 ? 'FWD' : 'REV';

    if (throttle > 0) {
      reverseLatchedRef.current = false;
      reverseHoldTimerRef.current = 0;
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
      driveState = speed < -0.1 ? 'BRAKE' : 'FWD';
    } else if (throttle < 0) {
      if (speed > 0.12) {
        // Pulling T-bar back applies dynamic regenerative/mechanical braking first
        speed = Math.max(0, speed - ACCEL * 1.85 * dt);
        reverseLatchedRef.current = false;
        reverseHoldTimerRef.current = 0;
        driveState = 'BRAKE';
      } else {
        if (!reverseLatchedRef.current) {
          speed = 0;
          reverseHoldTimerRef.current += dt;
          driveState = 'BRAKE';
          const latchDelay = reverseStartedStoppedRef.current ? 0.04 : 0.15;
          if (reverseHoldTimerRef.current >= latchDelay) {
            reverseLatchedRef.current = true;
            playSwitchClickSfx();
          }
        }
        if (reverseLatchedRef.current) {
          speed = Math.max(-REVERSE_SPEED, speed - ACCEL * 0.85 * dt);
          driveState = 'REV';
        }
      }
    } else {
      reverseHoldTimerRef.current = 0;
      if (speed >= -0.05) reverseLatchedRef.current = false;
      speed *= Math.exp(-DRAG * dt);
      if (Math.abs(speed) < 0.03) speed = 0;
      driveState = Math.abs(speed) < 0.08 ? 'NEUTRAL' : speed > 0 ? 'FWD' : 'REV';
    }

    const mode = steeringModeRef.current;
    const prevHeading = headingRef.current;
    if (steer !== 0) {
      const steerDir = speed < -0.25 ? -1 : 1;
      const modeTurnMult = mode === 'dual' ? 1.38 : 0.82;
      const steerFactor = THREE.MathUtils.clamp(0.48 + Math.abs(speed) / MAX_SPEED, 0.48, 1.15);
      headingRef.current += steer * steerDir * TURN_RATE * modeTurnMult * steerFactor * dt;
    }
    const yawDelta = headingRef.current - prevHeading;

    const fwdX = -Math.sin(headingRef.current);
    const fwdZ = -Math.cos(headingRef.current);

    const prevX = posRef.current.x;
    const prevZ = posRef.current.z;

    let nextX = THREE.MathUtils.clamp(
      prevX + fwdX * speed * dt,
      -HADLEY_PLAY_LIMIT,
      HADLEY_PLAY_LIMIT,
    );
    let nextZ = THREE.MathUtils.clamp(
      prevZ + fwdZ * speed * dt,
      -HADLEY_PLAY_LIMIT,
      HADLEY_PLAY_LIMIT,
    );

    const currentSample = sampler.sampleFootprint(prevX, prevZ);
    const nextSample = sampler.sampleFootprint(nextX, nextZ);
    if (nextSample.slopeDeg > MAX_DRIVABLE_SLOPE_DEG && nextSample.groundY > currentSample.groundY) {
      nextX = prevX;
      nextZ = prevZ;
      speed *= 0.25;
    }

    const dxLm = nextX - lmPos.x;
    const dzLm = nextZ - lmPos.z;
    const distLmSq = dxLm * dxLm + dzLm * dzLm;
    if (distLmSq < COLLISION_RADIUS * COLLISION_RADIUS) {
      const distLm = Math.sqrt(distLmSq) || 0.001;
      nextX = lmPos.x + (dxLm / distLm) * COLLISION_RADIUS;
      nextZ = lmPos.z + (dzLm / distLm) * COLLISION_RADIUS;
      speed *= 0.2;
    }

    speedRef.current = speed;
    const groundY = sampler.getHeight(nextX, nextZ);
    posRef.current.set(nextX, groundY, nextZ);
    roverPosRefOut.current.copy(posRef.current);
    group.position.copy(posRef.current);

    // LRV Dual/Front/Rear Ackermann steering + 4 independent 1/4-hp hub motor wheel spin
    const targetFrontSteer = mode === 'rear' ? 0 : steer * MAX_WHEEL_STEER;
    const targetRearSteer = mode === 'front' ? 0 : -steer * MAX_WHEEL_STEER;
    const steerLerp = 1 - Math.exp(-14 * dt);
    frontSteerRef.current = THREE.MathUtils.lerp(frontSteerRef.current, targetFrontSteer, steerLerp);
    rearSteerRef.current = THREE.MathUtils.lerp(rearSteerRef.current, targetRearSteer, steerLerp);

    const forwardStep = (nextX - prevX) * fwdX + (nextZ - prevZ) * fwdZ;
    const yawTrack = Math.abs(speed) < 0.8 ? 1.65 : 0.92;
    for (const rig of wheelRigs) {
      const baseAngle = rig.isFront ? frontSteerRef.current : rearSteerRef.current;
      const turningLeft = baseAngle !== 0 && (rig.isFront ? baseAngle > 0 : baseAngle < 0);
      const isInner = (turningLeft && rig.isLeft) || (!turningLeft && !rig.isLeft);
      const ackermannGain = Math.abs(baseAngle) > 0.01 ? (isInner ? 1.14 : 0.86) : 1;
      rig.steerGroup.rotation.y = baseAngle * ackermannGain;

      const wheelStep = forwardStep - (rig.isLeft ? yawTrack : -yawTrack) * yawDelta;
      rig.rollAngle -= wheelStep / WHEEL_WORLD_RADIUS;
      rig.spinGroup.rotation.z = rig.rollAngle;
    }

    // Animate central Apollo T-bar hand controller between the two seats
    const stickLerp = 1 - Math.exp(-16 * dt);
    tBarPitchRef.current = THREE.MathUtils.lerp(tBarPitchRef.current, throttle, stickLerp);
    tBarSteerRef.current = THREE.MathUtils.lerp(tBarSteerRef.current, steer, stickLerp);
    if (tBarRig) {
      tBarRig.rotation.z = -tBarPitchRef.current * 0.28;
      tBarRig.rotation.x = -tBarSteerRef.current * 0.24;
    }

    // Double-wishbone + torsion-bar suspension weight transfer in 1/6 lunar gravity
    const accelMetric = (speed - prevSpeed) / Math.max(dt, 0.005);
    const targetSuspPitch = THREE.MathUtils.clamp(accelMetric * 0.0014, -0.028, 0.028);
    const latRate = yawDelta / Math.max(dt, 0.005);
    const targetSuspRoll = THREE.MathUtils.clamp(
      -latRate * (Math.abs(speed) / MAX_SPEED) * 0.014,
      -0.024,
      0.024,
    );
    const suspLerp = 1 - Math.exp(-9 * dt);
    suspPitchRef.current = THREE.MathUtils.lerp(suspPitchRef.current, targetSuspPitch, suspLerp);
    suspRollRef.current = THREE.MathUtils.lerp(suspRollRef.current, targetSuspRoll, suspLerp);

    const groundDeltaVel = (groundY - prevGroundYRef.current) / Math.max(dt, 0.005);
    prevGroundYRef.current = groundY;
    const heaveImpulse = THREE.MathUtils.clamp(-groundDeltaVel * 0.35, -0.8, 0.8);
    suspHeaveVelRef.current +=
      (-suspHeaveRef.current * 34 - suspHeaveVelRef.current * 5.8 + heaveImpulse) * dt;
    suspHeaveRef.current = THREE.MathUtils.clamp(
      suspHeaveRef.current + suspHeaveVelRef.current * dt,
      -0.04,
      0.04,
    );

    if (suspensionGroupRef.current) {
      suspensionGroupRef.current.position.y = suspHeaveRef.current;
      suspensionGroupRef.current.rotation.x = suspPitchRef.current;
      suspensionGroupRef.current.rotation.z = suspRollRef.current;
    }

    sampler.getNormal(nextX, nextZ, tmpNormal);
    smoothNormalRef.current.lerp(tmpNormal, 1 - Math.exp(-10 * dt)).normalize();
    tmpFwdFlat.set(fwdX, 0, fwdZ);
    tmpRight.crossVectors(tmpFwdFlat, smoothNormalRef.current);
    if (tmpRight.lengthSq() < 1e-5) {
      tmpRight.set(Math.cos(headingRef.current), 0, -Math.sin(headingRef.current));
    }
    tmpRight.normalize();
    tmpZAxis.crossVectors(tmpRight, smoothNormalRef.current).normalize();
    tmpBasis.makeBasis(tmpRight, smoothNormalRef.current, tmpZAxis);
    tmpQuat.setFromRotationMatrix(tmpBasis);
    group.quaternion.slerp(tmpQuat, 1 - Math.exp(-12 * dt));

    const { bestSite, bestDist } = pickActiveTarget(nextX, nextZ);
    const nearbyRockId = bestSite && bestDist <= ROCK_GRAB_RANGE ? bestSite.spec.id : null;

    // Playful 3D Apollo tongs arm animation (ready pose near rock, chomp lunge on Space)
    if (tongsArmRef.current) {
      let ext = nearbyRockId ? 0.52 : 0;
      let jawAngle = nearbyRockId ? 0.42 : 0.08;
      if (swingProgressRef.current !== null) {
        swingProgressRef.current = Math.min(1, swingProgressRef.current + dt / 0.45);
        const s = swingProgressRef.current;
        const lunge = Math.sin(s * Math.PI);
        ext = 0.55 + lunge * 0.95;
        jawAngle = s < 0.45 ? 0.55 : 0.04;
        if (s >= 1) swingProgressRef.current = null;
      }
      tongsArmRef.current.rotation.x = THREE.MathUtils.lerp(
        tongsArmRef.current.rotation.x,
        -0.4 - ext * 0.65,
        1 - Math.exp(-16 * dt),
      );
      tongsArmRef.current.rotation.z = THREE.MathUtils.lerp(
        tongsArmRef.current.rotation.z,
        nearbyRockId ? -0.45 : 0.15,
        1 - Math.exp(-12 * dt),
      );
      if (tongsJawLeftRef.current && tongsJawRightRef.current) {
        tongsJawLeftRef.current.rotation.y = jawAngle;
        tongsJawRightRef.current.rotation.y = -jawAngle;
      }
    }

    const zoom = zoomRef.current;
    const followDist = 7.4 * zoom;
    const followHeight = 3.2 * zoom;
    const camGroundMin = sampler.getHeight(nextX - fwdX * followDist, nextZ - fwdZ * followDist);
    tmpDesiredCam.set(
      nextX - fwdX * followDist,
      Math.max(groundY + followHeight, camGroundMin + 1.8),
      nextZ - fwdZ * followDist,
    );
    tmpDesiredLook.set(nextX + fwdX * 3.0, groundY + 1.0, nextZ + fwdZ * 3.0);

    camPosRef.current.lerp(tmpDesiredCam, 1 - Math.exp(-6.5 * dt));
    camLookRef.current.lerp(tmpDesiredLook, 1 - Math.exp(-9 * dt));
    camera.position.copy(camPosRef.current);
    camera.lookAt(camLookRef.current);

    const nearbyChanged = prevNearbyRef.current !== nearbyRockId;
    if (nearbyChanged) prevNearbyRef.current = nearbyRockId;
    const driveStateChanged = prevDriveStateRef.current !== driveState;
    if (driveStateChanged) prevDriveStateRef.current = driveState;
    const modeChanged = prevSteeringModeRef.current !== mode;
    if (modeChanged) prevSteeringModeRef.current = mode;

    telemetryTimerRef.current += dt;
    if (telemetryTimerRef.current >= 0.065 || nearbyChanged || driveStateChanged || modeChanged) {
      telemetryTimerRef.current = 0;

      const allDone = !bestSite;
      const dxSite = bestSite ? bestSite.position.x - nextX : 0;
      const dzSite = bestSite ? bestSite.position.z - nextZ : 0;
      const distanceToSite = bestSite ? bestDist : 0;

      const rightX = Math.cos(headingRef.current);
      const rightZ = -Math.sin(headingRef.current);
      const forwardDot = dxSite * fwdX + dzSite * fwdZ;
      const rightDot = dxSite * rightX + dzSite * rightZ;
      const targetBearingDeg = bestSite ? (Math.atan2(rightDot, forwardDot) * 180) / Math.PI : 0;
      const rawHeadingDeg = ((-headingRef.current * 180) / Math.PI) % 360;
      const headingDeg = (rawHeadingDeg + 360) % 360;

      onDriveUpdate({
        speed: Math.abs(speed),
        distanceToSite,
        targetLabel: bestSite ? `${bestSite.spec.shortName} (${bestSite.spec.bagLabel})` : 'All Samples Bagged',
        headingDeg,
        targetBearingDeg,
        reachedSite: allDone,
        nearbyRockId,
        steeringMode: mode,
        driveState,
        tBarPitch: tBarPitchRef.current,
        tBarSteer: tBarSteerRef.current,
      });
    }
  });

  return (
    <>
      <group ref={roverGroupRef}>
        <group ref={suspensionGroupRef}>
          <group rotation={[0, Math.PI / 2, 0]}>
            <primitive object={preparedRover} />
          </group>

          {/* Apollo Long-Handled Tongs Arm mounted on side of LRV */}
          <group ref={tongsArmRef} position={[0.72, 0.72, -0.35]}>
            <mesh position={[0, -0.45, -0.35]} rotation={[0.6, 0, 0]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 1.15, 8]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.8} roughness={0.28} />
            </mesh>
            <group position={[0, -0.88, -0.68]}>
              <mesh ref={tongsJawLeftRef} position={[0.05, 0, -0.08]}>
                <boxGeometry args={[0.03, 0.04, 0.22]} />
                <meshStandardMaterial color="#f59e0b" metalness={0.6} roughness={0.35} />
              </mesh>
              <mesh ref={tongsJawRightRef} position={[-0.05, 0, -0.08]}>
                <boxGeometry args={[0.03, 0.04, 0.22]} />
                <meshStandardMaterial color="#f59e0b" metalness={0.6} roughness={0.35} />
              </mesh>
            </group>
          </group>

          {/* Numbered Apollo Sample Bag Basket on back of Rover showing bagged stones */}
          <group position={[0, 0.68, 1.05]}>
            <mesh castShadow>
              <boxGeometry args={[0.68, 0.22, 0.3]} />
              <meshStandardMaterial color="#475569" metalness={0.65} roughness={0.4} />
            </mesh>
            {LUNAR_ROCK_SPECS.map((spec, idx) =>
              collectedSet.has(spec.id) ? (
                <mesh key={spec.id} position={[-0.22 + idx * 0.145, 0.16, 0]}>
                  <dodecahedronGeometry args={[0.08, 0]} />
                  <meshStandardMaterial
                    color={spec.swatchColor}
                    roughness={0.5}
                    emissive={spec.id === 'genesis_rock' ? '#fef08a' : '#000000'}
                    emissiveIntensity={spec.id === 'genesis_rock' ? 0.5 : 0}
                  />
                </mesh>
              ) : null,
            )}
          </group>
        </group>
      </group>

      <LunarDust
        roverPosRef={posRef}
        roverHeadingRef={headingRef}
        roverSpeedRef={speedRef}
        sampler={sampler}
      />
    </>
  );
}

useGLTF.preload(roverUrl);
