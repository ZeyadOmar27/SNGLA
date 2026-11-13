import { useCallback, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import lmUrl from '../assets/apollo_lunar_module.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { pickExplorationSite, type TerrainSampler } from '../utils/hadleyTerrain';
import { HadleyTerrain } from './HadleyTerrain';
import { LM_FOOTPRINT, tuneApolloModuleMaterial } from './LunarModule';
import { Rover, type DriveTelemetry } from './Rover';

interface Level2RoverProps {
  resetNonce: number;
  onDriveTelemetry: (telemetry: DriveTelemetry) => void;
}

const BASECAMP_XZ: readonly [number, number] = [-10, 12];
const ROVER_SPAWN_XZ: readonly [number, number] = [2, 4];
const INITIAL_ROVER_HEADING = 0.62;
const SITE_MARKER_RADIUS = 4.5;

function ExplorationSiteBeacon({
  sitePos,
  sampler,
  reached,
}: {
  sitePos: THREE.Vector3;
  sampler: TerrainSampler;
  reached: boolean;
}) {
  const pulseRef = useRef<THREE.Mesh>(null);

  const ringQuat = useMemo(() => {
    const n = sampler.getNormal(sitePos.x, sitePos.z);
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }, [sitePos, sampler]);

  useFrame(({ clock }) => {
    if (!pulseRef.current) return;
    const s = 1 + 0.14 * Math.sin(clock.getElapsedTime() * 3.4);
    pulseRef.current.scale.setScalar(s);
  });

  const accent = reached ? '#34d399' : '#38bdf8';

  return (
    <group position={[sitePos.x, sitePos.y, sitePos.z]}>
      <mesh quaternion={ringQuat} position={[0, 0.08, 0]}>
        <ringGeometry args={[SITE_MARKER_RADIUS - 0.35, SITE_MARKER_RADIUS, 48]} />
        <meshBasicMaterial color={accent} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh quaternion={ringQuat} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.9, 1.35, 32]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.65, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 3.3, 10]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.75} roughness={0.35} />
      </mesh>
      <mesh position={[0.55, 2.85, 0]} castShadow>
        <boxGeometry args={[1.05, 0.62, 0.05]} />
        <meshStandardMaterial color="#1d4ed8" metalness={0.2} roughness={0.65} />
      </mesh>
      <mesh ref={pulseRef} position={[0, 3.45, 0]}>
        <sphereGeometry args={[0.24, 16, 16]} />
        <meshBasicMaterial color={accent} />
      </mesh>
    </group>
  );
}

export function Level2Rover({ resetNonce, onDriveTelemetry }: Level2RoverProps) {
  const { scene } = useGLTF(lmUrl);
  const { gl } = useThree();

  const [sampler, setSampler] = useState<TerrainSampler | null>(null);
  const [siteReached, setSiteReached] = useState(false);

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
    const site1Pos = pickExplorationSite(lmX, lmZ, sampler);

    return { lmPos, lmTiltQuat, spawnPos, site1Pos };
  }, [sampler]);

  const handleDriveUpdate = useCallback(
    (telemetry: DriveTelemetry) => {
      setSiteReached(telemetry.reachedSite);
      onDriveTelemetry(telemetry);
    },
    [onDriveTelemetry],
  );

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
            site1Pos={layout.site1Pos}
            resetNonce={resetNonce}
            onDriveUpdate={handleDriveUpdate}
          />

          <ExplorationSiteBeacon
            sitePos={layout.site1Pos}
            sampler={sampler}
            reached={siteReached}
          />
        </>
      )}
    </>
  );
}

useGLTF.preload(lmUrl);

