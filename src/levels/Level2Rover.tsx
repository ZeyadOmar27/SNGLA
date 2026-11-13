import { useCallback, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import lmUrl from '@assets/Apollo_ Lunar_ Module.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { type TerrainSampler } from '../utils/hadleyTerrain';
import type { LunarRockKind } from '../utils/lunarRocks';
import { HadleyTerrain } from '../entities/HadleyTerrain';
import { LunarRocks, buildWorldRockSites } from '../entities/LunarRocks';
import { LM_FOOTPRINT, tuneApolloModuleMaterial } from '../entities/LunarModule';
import { Rover, type DriveTelemetry, type LrvSteeringMode } from '../entities/Rover';

interface Level2RoverProps {
  resetNonce: number;
  collectedSet: ReadonlySet<LunarRockKind>;
  nearbyRockId: LunarRockKind | null;
  fumbleEvent: { rockId: LunarRockKind; nonce: number } | null;
  grabSwingNonce: number;
  steeringMode: LrvSteeringMode;
  onCycleSteeringMode: () => void;
  onDriveTelemetry: (telemetry: DriveTelemetry) => void;
}

const BASECAMP_XZ: readonly [number, number] = [-10, 12];
const ROVER_SPAWN_XZ: readonly [number, number] = [2, 4];
const INITIAL_ROVER_HEADING = 0.62;

export function Level2Rover({
  resetNonce,
  collectedSet,
  nearbyRockId,
  fumbleEvent,
  grabSwingNonce,
  steeringMode,
  onCycleSteeringMode,
  onDriveTelemetry,
}: Level2RoverProps) {
  const { scene } = useGLTF(lmUrl);
  const { gl } = useThree();

  const [sampler, setSampler] = useState<TerrainSampler | null>(null);
  const roverPosRef = useRef(new THREE.Vector3(ROVER_SPAWN_XZ[0], 0, ROVER_SPAWN_XZ[1]));

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

  const layout = useMemo(() => {
    if (!sampler) return null;

    const [lmX, lmZ] = BASECAMP_XZ;
    const lmSample = sampler.sampleFootprint(lmX, lmZ);
    const lmPos = new THREE.Vector3(lmX, lmSample.groundY, lmZ);
    const lmTiltQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      lmSample.normal,
    );

    const [rvX, rvZ] = ROVER_SPAWN_XZ;
    const spawnPos = new THREE.Vector3(rvX, sampler.getHeight(rvX, rvZ), rvZ);
    const rockSites = buildWorldRockSites(sampler);

    return { lmPos, lmTiltQuat, spawnPos, rockSites };
  }, [sampler]);

  return (
    <>
      <HadleyTerrain onSamplerReady={handleSamplerReady} />

      {sampler && layout && (
        <>
          {/* Parked Falcon Basecamp settled cleanly onto real lunar regolith */}
          <group position={layout.lmPos} quaternion={layout.lmTiltQuat}>
            <group rotation={[0, Math.PI * 0.65, 0]}>
              <primitive object={preparedLm} />
            </group>
          </group>

          <Rover
            sampler={sampler}
            spawnPos={layout.spawnPos}
            initialHeading={INITIAL_ROVER_HEADING}
            lmPos={layout.lmPos}
            rockSites={layout.rockSites}
            collectedSet={collectedSet}
            grabSwingNonce={grabSwingNonce}
            steeringMode={steeringMode}
            onCycleSteeringMode={onCycleSteeringMode}
            roverPosRefOut={roverPosRef}
            resetNonce={resetNonce}
            onDriveUpdate={onDriveTelemetry}
          />

          <LunarRocks
            sites={layout.rockSites}
            sampler={sampler}
            roverPosRef={roverPosRef}
            collectedSet={collectedSet}
            nearbyRockId={nearbyRockId}
            fumbleEvent={fumbleEvent}
            resetNonce={resetNonce}
          />
        </>
      )}
    </>
  );
}

useGLTF.preload(lmUrl);
