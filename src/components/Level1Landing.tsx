import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import lmUrl from '../assets/apollo_lunar_module.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { HADLEY_PLAY_LIMIT, type TerrainSampler } from '../utils/hadleyTerrain';
import { HadleyTerrain } from './HadleyTerrain';
import { LM_FOOTPRINT, tuneApolloModuleMaterial } from './LunarModule';

export interface LandingTelemetry {
  altitude: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  slopeDeg: number;
  fuel: number;
  status: 'descending' | 'landed' | 'crashed';
  failReason: string | null;
}

interface Level1LandingProps {
  resetNonce: number;
  onTelemetry: (telemetry: LandingTelemetry) => void;
}

const START_POS = new THREE.Vector3(0, 32, -8);
const CAMERA_FOV = 62;
const LUNAR_GRAVITY = 2.6;
const MAIN_THRUST_ACCEL = 6.2;
const RCS_ACCEL = 8.4;
const HORIZ_DAMP = 1.45;
const SAFE_MAX_IMPACT_SPEED = 3.4;
const SAFE_MAX_HORIZ_SPEED = 2.6;
const WARNING_SLOPE_DEG = 8;
const MAX_SAFE_SLOPE_DEG = 12.5;

export function Level1Landing({ resetNonce, onTelemetry }: Level1LandingProps) {
  const { scene } = useGLTF(lmUrl);
  const { gl, camera } = useThree();

  const [sampler, setSampler] = useState<TerrainSampler | null>(null);

  const lmGroupRef = useRef<THREE.Group>(null);
  const plumeRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const posRef = useRef(START_POS.clone());
  const velRef = useRef(new THREE.Vector3(0, -0.6, 0));
  const fuelRef = useRef(100);
  const statusRef = useRef<'descending' | 'landed' | 'crashed'>('descending');
  const failReasonRef = useRef<string | null>(null);
  const tiltRef = useRef({ pitch: 0, roll: 0 });
  const zoomRef = useRef(1);
  const camPosRef = useRef(new THREE.Vector3(-6, 42, 10));
  const camLookRef = useRef(START_POS.clone());
  const keysRef = useRef<Record<string, boolean>>({});
  const telemetryTimerRef = useRef(0);

  const tmpVecA = useMemo(() => new THREE.Vector3(), []);
  const tmpVecB = useMemo(() => new THREE.Vector3(), []);
  const tmpZVec = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpEuler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);

  const preparedLm = useMemo(() => {
    return prepareAndSoftenModel(scene, {
      targetSize: LM_FOOTPRINT,
      maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
      onMaterial: tuneApolloModuleMaterial,
    });
  }, [scene, gl]);

  const handleSamplerReady = useCallback((nextSampler: TerrainSampler) => {
    setSampler(nextSampler);
  }, []);

  const resetFalcon = useCallback(() => {
    posRef.current.copy(START_POS);
    velRef.current.set(0, -0.6, 0);
    fuelRef.current = 100;
    statusRef.current = 'descending';
    failReasonRef.current = null;
    tiltRef.current = { pitch: 0, roll: 0 };
    telemetryTimerRef.current = 0;

    camPosRef.current.set(START_POS.x - 6, START_POS.y + 9.5, START_POS.z + 18.5);
    camLookRef.current.set(START_POS.x, START_POS.y - 3.5, START_POS.z);

    if (lmGroupRef.current) {
      lmGroupRef.current.position.copy(posRef.current);
      lmGroupRef.current.quaternion.identity();
    }
    if (plumeRef.current) {
      plumeRef.current.visible = false;
    }

    const slopeDeg = sampler ? sampler.sampleFootprint(START_POS.x, START_POS.z).slopeDeg : 0;
    const groundY = sampler ? sampler.getHeight(START_POS.x, START_POS.z) : 0;
    onTelemetry({
      altitude: Math.max(0, START_POS.y - groundY),
      verticalSpeed: 0.6,
      horizontalSpeed: 0,
      slopeDeg,
      fuel: 100,
      status: 'descending',
      failReason: null,
    });
  }, [sampler, onTelemetry]);

  useEffect(() => {
    resetFalcon();
  }, [resetNonce, resetFalcon]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.code] = true;
      if (e.code === 'KeyR') {
        resetFalcon();
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
  }, [resetFalcon]);

  useFrame(({ clock }, rawDelta) => {
    if (!sampler || !lmGroupRef.current) return;

    const dt = Math.min(rawDelta, 0.05);
    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - CAMERA_FOV) > 0.1) {
      camera.fov = CAMERA_FOV;
      camera.updateProjectionMatrix();
    }

    const lmGroup = lmGroupRef.current;
    const pos = posRef.current;
    const vel = velRef.current;
    const keys = keysRef.current;
    const isDescending = statusRef.current === 'descending';
    let mainThrusting = false;

    if (isDescending) {
      const wantsMainThrust =
        Boolean(keys['Space'] || keys['KeyE'] || keys['ShiftLeft'] || keys['ShiftRight']) &&
        fuelRef.current > 0;

      const inputZ =
        (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) -
        (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0);
      const inputX =
        (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) -
        (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);

      let ay = -LUNAR_GRAVITY;
      if (wantsMainThrust) {
        ay += MAIN_THRUST_ACCEL;
        fuelRef.current = Math.max(0, fuelRef.current - dt * 6.5);
        mainThrusting = true;
      }

      if ((inputX !== 0 || inputZ !== 0) && fuelRef.current > 0) {
        vel.x += inputX * RCS_ACCEL * dt;
        vel.z += inputZ * RCS_ACCEL * dt;
        fuelRef.current = Math.max(0, fuelRef.current - dt * 1.4);
      } else {
        const damp = Math.exp(-HORIZ_DAMP * dt);
        vel.x *= damp;
        vel.z *= damp;
      }

      vel.x = THREE.MathUtils.clamp(vel.x, -14, 14);
      vel.z = THREE.MathUtils.clamp(vel.z, -14, 14);
      vel.y = THREE.MathUtils.clamp(vel.y + ay * dt, -18, 9);

      pos.x = THREE.MathUtils.clamp(
        pos.x + vel.x * dt,
        -HADLEY_PLAY_LIMIT + 8,
        HADLEY_PLAY_LIMIT - 8,
      );
      pos.z = THREE.MathUtils.clamp(
        pos.z + vel.z * dt,
        -HADLEY_PLAY_LIMIT + 8,
        HADLEY_PLAY_LIMIT - 8,
      );
      pos.y += vel.y * dt;

      const targetPitch = THREE.MathUtils.clamp(inputZ * 0.16 + vel.z * 0.015, -0.24, 0.24);
      const targetRoll = THREE.MathUtils.clamp(-inputX * 0.16 - vel.x * 0.015, -0.24, 0.24);
      tiltRef.current.pitch = THREE.MathUtils.lerp(
        tiltRef.current.pitch,
        targetPitch,
        1 - Math.exp(-7 * dt),
      );
      tiltRef.current.roll = THREE.MathUtils.lerp(
        tiltRef.current.roll,
        targetRoll,
        1 - Math.exp(-7 * dt),
      );
      tmpEuler.set(tiltRef.current.pitch, 0, tiltRef.current.roll, 'YXZ');
      lmGroup.quaternion.setFromEuler(tmpEuler);

      const sample = sampler.sampleFootprint(pos.x, pos.z);
      if (pos.y <= sample.groundY) {
        const impactSpeed = Math.max(0, -vel.y);
        const horizSpeed = Math.hypot(vel.x, vel.z);

        pos.y = sample.groundY;
        vel.set(0, 0, 0);

        if (sample.slopeDeg > MAX_SAFE_SLOPE_DEG) {
          statusRef.current = 'crashed';
          failReasonRef.current = `Slope too steep (${sample.slopeDeg.toFixed(1)}° > ${MAX_SAFE_SLOPE_DEG}°). Aim for flatter mare terrain.`;
        } else if (impactSpeed > SAFE_MAX_IMPACT_SPEED) {
          statusRef.current = 'crashed';
          failReasonRef.current = `Hard touchdown (${impactSpeed.toFixed(1)} m/s > ${SAFE_MAX_IMPACT_SPEED} m/s). Feather Space thruster right before contact.`;
        } else if (horizSpeed > SAFE_MAX_HORIZ_SPEED) {
          statusRef.current = 'crashed';
          failReasonRef.current = `Excessive lateral drift (${horizSpeed.toFixed(1)} m/s > ${SAFE_MAX_HORIZ_SPEED} m/s).`;
        } else {
          statusRef.current = 'landed';
          failReasonRef.current = null;
          tmpVecA.set(0, 1, 0);
          tmpQuat.setFromUnitVectors(tmpVecA, sample.normal);
          lmGroup.quaternion.copy(tmpQuat);
        }

        onTelemetry({
          altitude: 0,
          verticalSpeed: impactSpeed,
          horizontalSpeed: horizSpeed,
          slopeDeg: sample.slopeDeg,
          fuel: fuelRef.current,
          status: statusRef.current,
          failReason: failReasonRef.current,
        });
      }
    }

    lmGroup.position.copy(pos);

    if (plumeRef.current) {
      plumeRef.current.visible = isDescending && mainThrusting;
      if (plumeRef.current.visible) {
        const flicker = 0.88 + 0.24 * Math.sin(clock.getElapsedTime() * 42);
        plumeRef.current.scale.set(1, flicker, 1);
      }
    }

    const groundSample = sampler.sampleFootprint(pos.x, pos.z);
    if (ringRef.current && ringMatRef.current) {
      ringRef.current.visible = isDescending;
      if (isDescending) {
        ringRef.current.position.set(pos.x, groundSample.groundY + 0.1, pos.z);
        tmpQuat.setFromUnitVectors(tmpZVec, groundSample.normal);
        ringRef.current.quaternion.copy(tmpQuat);

        if (groundSample.slopeDeg <= WARNING_SLOPE_DEG) {
          ringMatRef.current.color.set('#22c55e');
        } else if (groundSample.slopeDeg <= MAX_SAFE_SLOPE_DEG) {
          ringMatRef.current.color.set('#f59e0b');
        } else {
          ringMatRef.current.color.set('#ef4444');
        }
      }
    }

    const zoom = zoomRef.current;
    const altitude = Math.max(0, pos.y - groundSample.groundY);
    const camHeightOffset = (altitude > 10 ? 9.5 : 6.2) * zoom;
    const camSideOffset = -6.0 * zoom;
    const camBackOffset = (altitude > 10 ? 18.0 : 13.0) * zoom;

    tmpVecA.set(pos.x + camSideOffset, pos.y + camHeightOffset, pos.z + camBackOffset);
    tmpVecB.set(pos.x, Math.max(groundSample.groundY + 0.5, pos.y - 2.6), pos.z);

    camPosRef.current.lerp(tmpVecA, 1 - Math.exp(-4.5 * dt));
    camLookRef.current.lerp(tmpVecB, 1 - Math.exp(-6.5 * dt));
    camera.position.copy(camPosRef.current);
    camera.lookAt(camLookRef.current);

    if (isDescending) {
      telemetryTimerRef.current += dt;
      if (telemetryTimerRef.current >= 0.065) {
        telemetryTimerRef.current = 0;
        onTelemetry({
          altitude,
          verticalSpeed: Math.max(0, -vel.y),
          horizontalSpeed: Math.hypot(vel.x, vel.z),
          slopeDeg: groundSample.slopeDeg,
          fuel: fuelRef.current,
          status: statusRef.current,
          failReason: failReasonRef.current,
        });
      }
    }
  });

  return (
    <>
      <HadleyTerrain onSamplerReady={handleSamplerReady} />

      <group ref={lmGroupRef} position={START_POS}>
        <primitive object={preparedLm} />
        <mesh ref={plumeRef} position={[0, -0.55, 0]} rotation={[Math.PI, 0, 0]} visible={false}>
          <coneGeometry args={[0.72, 2.5, 16, 1, true]} />
          <meshBasicMaterial
            color="#fbbf24"
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>

      <mesh ref={ringRef}>
        <ringGeometry args={[3.1, 3.65, 48]} />
        <meshBasicMaterial
          ref={ringMatRef}
          color="#22c55e"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}

useGLTF.preload(lmUrl);

