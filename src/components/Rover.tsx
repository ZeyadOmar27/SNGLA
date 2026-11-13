import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import roverUrl from '../assets/lunar_Rover.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { HADLEY_PLAY_LIMIT, type TerrainSampler } from '../utils/hadleyTerrain';
import { LUNAR_ROCK_SPECS, type LunarRockKind } from '../utils/lunarRocks';
import type { WorldRockSite } from './LunarRocks';
import { LM_HALF_EXTENT } from './LunarModule';
import { LunarDust } from './LunarDust';

export interface DriveTelemetry {
  speed: number;
  distanceToSite: number;
  targetLabel: string;
  headingDeg: number;
  targetBearingDeg: number;
  reachedSite: boolean;
  nearbyRockId: LunarRockKind | null;
}

export interface RoverProps {
  sampler: TerrainSampler;
  spawnPos: THREE.Vector3;
  initialHeading: number;
  lmPos: THREE.Vector3;
  rockSites: readonly WorldRockSite[];
  collectedSet: ReadonlySet<LunarRockKind>;
  grabSwingNonce: number;
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

export function Rover({
  sampler,
  spawnPos,
  initialHeading,
  lmPos,
  rockSites,
  collectedSet,
  grabSwingNonce,
  roverPosRefOut,
  resetNonce,
  onDriveUpdate,
}: RoverProps) {
  const { scene } = useGLTF(roverUrl);
  const { gl, camera } = useThree();

  const roverGroupRef = useRef<THREE.Group>(null);
  const tongsArmRef = useRef<THREE.Group>(null);
  const tongsJawLeftRef = useRef<THREE.Mesh>(null);
  const tongsJawRightRef = useRef<THREE.Mesh>(null);

  const posRef = useRef(spawnPos.clone());
  const headingRef = useRef(initialHeading);
  const speedRef = useRef(0);
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

  const preparedRover = useMemo(() => {
    return prepareAndSoftenModel(scene, {
      targetSize: 2.8,
      maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
    });
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

  // Initialize / reset rover cleanly at open lunar mare spawn point
  useEffect(() => {
    const groundY = sampler.getHeight(spawnPos.x, spawnPos.z);
    posRef.current.set(spawnPos.x, groundY, spawnPos.z);
    roverPosRefOut.current.copy(posRef.current);
    headingRef.current = initialHeading;
    speedRef.current = 0;
    prevNearbyRef.current = null;
    sampler.getNormal(spawnPos.x, spawnPos.z, smoothNormalRef.current);

    const fwdX = -Math.sin(initialHeading);
    const fwdZ = -Math.cos(initialHeading);
    camPosRef.current.set(spawnPos.x - fwdX * 7.6, groundY + 3.4, spawnPos.z - fwdZ * 7.6);
    camLookRef.current.set(spawnPos.x + fwdX * 3.5, groundY + 1.0, spawnPos.z + fwdZ * 3.5);
    camera.position.copy(camPosRef.current);
    camera.lookAt(camLookRef.current);

    if (roverGroupRef.current) {
      roverGroupRef.current.position.copy(posRef.current);
    }
  }, [sampler, spawnPos, initialHeading, resetNonce, camera, roverPosRefOut]);

  useEffect(() => {
    const resetToSpawn = () => {
      const groundY = sampler.getHeight(spawnPos.x, spawnPos.z);
      posRef.current.set(spawnPos.x, groundY, spawnPos.z);
      roverPosRefOut.current.copy(posRef.current);
      headingRef.current = initialHeading;
      speedRef.current = 0;
      sampler.getNormal(spawnPos.x, spawnPos.z, smoothNormalRef.current);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      if (e.code === 'KeyR') {
        resetToSpawn();
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

    let speed = speedRef.current;
    if (throttle > 0) {
      speed = Math.min(MAX_SPEED, speed + ACCEL * dt);
    } else if (throttle < 0) {
      speed = Math.max(-REVERSE_SPEED, speed - ACCEL * 0.85 * dt);
    } else {
      speed *= Math.exp(-DRAG * dt);
      if (Math.abs(speed) < 0.03) speed = 0;
    }

    if (steer !== 0) {
      const steerDir = speed < -0.25 ? -1 : 1;
      const steerFactor = THREE.MathUtils.clamp(0.45 + Math.abs(speed) / MAX_SPEED, 0.45, 1.15);
      headingRef.current += steer * steerDir * TURN_RATE * steerFactor * dt;
    }

    const fwdX = -Math.sin(headingRef.current);
    const fwdZ = -Math.cos(headingRef.current);

    let nextX = THREE.MathUtils.clamp(
      posRef.current.x + fwdX * speed * dt,
      -HADLEY_PLAY_LIMIT,
      HADLEY_PLAY_LIMIT,
    );
    let nextZ = THREE.MathUtils.clamp(
      posRef.current.z + fwdZ * speed * dt,
      -HADLEY_PLAY_LIMIT,
      HADLEY_PLAY_LIMIT,
    );

    const currentSample = sampler.sampleFootprint(posRef.current.x, posRef.current.z);
    const nextSample = sampler.sampleFootprint(nextX, nextZ);
    if (nextSample.slopeDeg > MAX_DRIVABLE_SLOPE_DEG && nextSample.groundY > currentSample.groundY) {
      nextX = posRef.current.x;
      nextZ = posRef.current.z;
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

    telemetryTimerRef.current += dt;
    if (telemetryTimerRef.current >= 0.065 || nearbyChanged) {
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
      });
    }
  });

  return (
    <>
      <group ref={roverGroupRef}>
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
