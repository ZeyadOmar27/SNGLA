import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import roverUrl from '../assets/lunar_Rover.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { HADLEY_PLAY_LIMIT, type TerrainSampler } from '../utils/hadleyTerrain';
import { LM_HALF_EXTENT } from './LunarModule';
import { LunarDust } from './LunarDust';

export interface DriveTelemetry {
  speed: number;
  distanceToSite: number;
  headingDeg: number;
  targetBearingDeg: number;
  reachedSite: boolean;
}

export interface RoverProps {
  sampler: TerrainSampler;
  spawnPos: THREE.Vector3;
  initialHeading: number;
  lmPos: THREE.Vector3;
  site1Pos: THREE.Vector3;
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
const SITE_ARRIVAL_RADIUS = 4.5;
const MAX_DRIVABLE_SLOPE_DEG = 34;

export function Rover({
  sampler,
  spawnPos,
  initialHeading,
  lmPos,
  site1Pos,
  resetNonce,
  onDriveUpdate,
}: RoverProps) {
  const { scene } = useGLTF(roverUrl);
  const { gl, camera } = useThree();

  const roverGroupRef = useRef<THREE.Group>(null);
  const posRef = useRef(spawnPos.clone());
  const headingRef = useRef(initialHeading);
  const speedRef = useRef(0);
  const smoothNormalRef = useRef(new THREE.Vector3(0, 1, 0));
  const camPosRef = useRef(new THREE.Vector3());
  const camLookRef = useRef(new THREE.Vector3());
  const zoomRef = useRef(1);
  const keysRef = useRef<Record<string, boolean>>({});
  const reachedSiteRef = useRef(false);
  const telemetryTimerRef = useRef(0);

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

  // Initialize / reset rover cleanly at open lunar mare spawn point
  useEffect(() => {
    const groundY = sampler.getHeight(spawnPos.x, spawnPos.z);
    posRef.current.set(spawnPos.x, groundY, spawnPos.z);
    headingRef.current = initialHeading;
    speedRef.current = 0;
    reachedSiteRef.current = false;
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

    const dxSite = site1Pos.x - spawnPos.x;
    const dzSite = site1Pos.z - spawnPos.z;
    const rightX = Math.cos(initialHeading);
    const rightZ = -Math.sin(initialHeading);
    const forwardDot = dxSite * fwdX + dzSite * fwdZ;
    const rightDot = dxSite * rightX + dzSite * rightZ;
    onDriveUpdate({
      speed: 0,
      distanceToSite: Math.hypot(dxSite, dzSite),
      headingDeg: (((-initialHeading * 180) / Math.PI) % 360 + 360) % 360,
      targetBearingDeg: (Math.atan2(rightDot, forwardDot) * 180) / Math.PI,
      reachedSite: false,
    });
  }, [sampler, spawnPos, initialHeading, site1Pos, resetNonce, camera, onDriveUpdate]);

  useEffect(() => {
    const resetToSpawn = () => {
      const groundY = sampler.getHeight(spawnPos.x, spawnPos.z);
      posRef.current.set(spawnPos.x, groundY, spawnPos.z);
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
  }, [sampler, spawnPos, initialHeading]);

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

    const dxSite = site1Pos.x - nextX;
    const dzSite = site1Pos.z - nextZ;
    const distanceToSite = Math.hypot(dxSite, dzSite);
    const newlyReached = !reachedSiteRef.current && distanceToSite < SITE_ARRIVAL_RADIUS;
    if (newlyReached) {
      reachedSiteRef.current = true;
    }

    telemetryTimerRef.current += dt;
    if (telemetryTimerRef.current >= 0.065 || newlyReached) {
      telemetryTimerRef.current = 0;

      const rightX = Math.cos(headingRef.current);
      const rightZ = -Math.sin(headingRef.current);
      const forwardDot = dxSite * fwdX + dzSite * fwdZ;
      const rightDot = dxSite * rightX + dzSite * rightZ;
      const targetBearingDeg = (Math.atan2(rightDot, forwardDot) * 180) / Math.PI;
      const rawHeadingDeg = ((-headingRef.current * 180) / Math.PI) % 360;
      const headingDeg = (rawHeadingDeg + 360) % 360;

      onDriveUpdate({
        speed: Math.abs(speed),
        distanceToSite,
        headingDeg,
        targetBearingDeg,
        reachedSite: reachedSiteRef.current,
      });
    }
  });

  return (
    <>
      <group ref={roverGroupRef}>
        <group rotation={[0, Math.PI / 2, 0]}>
          <primitive object={preparedRover} />
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
