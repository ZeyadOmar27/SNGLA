import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainSampler } from '../utils/hadleyTerrain';
import { LUNAR_ROCK_SPECS, type LunarRockKind, type LunarRockSpec } from '../utils/lunarRocks';

export interface WorldRockSite {
  spec: LunarRockSpec;
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface LunarRocksProps {
  sites: readonly WorldRockSite[];
  sampler: TerrainSampler;
  roverPosRef: React.RefObject<THREE.Vector3>;
  collectedSet: ReadonlySet<LunarRockKind>;
  nearbyRockId: LunarRockKind | null;
  fumbleEvent: { rockId: LunarRockKind; nonce: number } | null;
  resetNonce: number;
}

function buildFacetedRockGeo(radius: number, seed: number, squashY = 0.78): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(radius, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * 3.7 + seed * 1.9) * 0.16 +
      Math.cos(z * 4.3 - seed * 2.3) * 0.14 +
      Math.sin((x + y + z) * 5.1 + seed) * 0.08;
    const scale = 1 + n;
    pos.setXYZ(i, x * scale, y * scale * squashY, z * scale);
  }
  geo.computeVertexNormals();
  return geo;
}

function SingleRockNode({
  site,
  sampler,
  roverPosRef,
  isCollected,
  isNearby,
  fumbleNonce,
  resetNonce,
}: {
  site: WorldRockSite;
  sampler: TerrainSampler;
  roverPosRef: React.RefObject<THREE.Vector3>;
  isCollected: boolean;
  isNearby: boolean;
  fumbleNonce: number;
  resetNonce: number;
}) {
  const specimenRef = useRef<THREE.Group>(null);
  const dustRingRef = useRef<THREE.Mesh>(null);
  const dustMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const beaconPulseRef = useRef<THREE.Mesh>(null);

  const flyProgressRef = useRef<number | null>(null);
  const doneFlyingRef = useRef(false);
  const fumbleProgressRef = useRef<number | null>(null);
  const startFlyWorldRef = useRef(new THREE.Vector3());

  const ringQuat = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), site.normal),
    [site.normal],
  );

  const rockGeo = useMemo(() => {
    switch (site.spec.id) {
      case 'solid_basalt':
        return buildFacetedRockGeo(0.62, 11, 0.72);
      case 'vesicular_basalt':
        return buildFacetedRockGeo(0.58, 27, 0.8);
      case 'anorthosite':
        return buildFacetedRockGeo(0.56, 43, 0.84);
      case 'genesis_rock':
        return buildFacetedRockGeo(0.32, 71, 0.78);
    }
  }, [site.spec.id]);

  const pedestalGeo = useMemo(
    () => (site.spec.id === 'genesis_rock' ? buildFacetedRockGeo(0.68, 93, 0.68) : null),
    [site.spec.id],
  );

  const chipGeo = useMemo(() => buildFacetedRockGeo(0.24, 55, 0.65), []);

  // Reset per-rock visual animations cleanly on mission reset
  useEffect(() => {
    flyProgressRef.current = null;
    doneFlyingRef.current = false;
    fumbleProgressRef.current = null;
    if (specimenRef.current) {
      const baseY = site.spec.id === 'genesis_rock' ? 0.52 : 0.32;
      specimenRef.current.visible = true;
      specimenRef.current.position.set(site.position.x, site.position.y + baseY, site.position.z);
      specimenRef.current.rotation.set(0, 0, 0);
      specimenRef.current.scale.setScalar(1);
    }
    if (dustRingRef.current) {
      dustRingRef.current.visible = false;
    }
  }, [resetNonce, site]);

  // Trigger ballistic low-gravity launch into Rover basket when collected
  useEffect(() => {
    if (isCollected && flyProgressRef.current === null && !doneFlyingRef.current) {
      const baseY = site.spec.id === 'genesis_rock' ? 0.52 : 0.32;
      startFlyWorldRef.current.set(site.position.x, site.position.y + baseY, site.position.z);
      flyProgressRef.current = 0;
    }
  }, [isCollected, site]);

  // Trigger comical wobble + regolith splash ring when tongs fumble
  useEffect(() => {
    if (fumbleNonce > 0) {
      fumbleProgressRef.current = 0;
    }
  }, [fumbleNonce]);

  useFrame(({ clock }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const tClock = clock.getElapsedTime();

    if (beaconPulseRef.current) {
      beaconPulseRef.current.scale.setScalar(1 + 0.16 * Math.sin(tClock * 3.6));
    }

    // Comic fumble wobble & dust splash ring
    if (fumbleProgressRef.current !== null) {
      fumbleProgressRef.current = Math.min(1, fumbleProgressRef.current + dt / 0.65);
      const u = fumbleProgressRef.current;

      if (dustRingRef.current && dustMatRef.current) {
        dustRingRef.current.visible = true;
        dustRingRef.current.scale.setScalar(0.8 + u * 2.8);
        dustMatRef.current.opacity = (1 - u) * 0.72;
      }

      if (specimenRef.current && flyProgressRef.current === null && !doneFlyingRef.current) {
        const baseY = site.spec.id === 'genesis_rock' ? 0.52 : 0.32;
        const hop = Math.sin(u * Math.PI) * 0.58;
        const wobble = Math.sin(u * Math.PI * 6) * 0.45 * (1 - u);
        specimenRef.current.position.set(
          site.position.x,
          site.position.y + baseY + hop,
          site.position.z,
        );
        specimenRef.current.rotation.set(wobble, u * 1.8, -wobble * 0.7);
      }

      if (u >= 1) {
        fumbleProgressRef.current = null;
        if (dustRingRef.current) dustRingRef.current.visible = false;
        if (specimenRef.current && flyProgressRef.current === null && !doneFlyingRef.current) {
          const baseY = site.spec.id === 'genesis_rock' ? 0.52 : 0.32;
          specimenRef.current.position.set(
            site.position.x,
            site.position.y + baseY,
            site.position.z,
          );
          specimenRef.current.rotation.set(0, 0, 0);
        }
      }
    }

    // Low-gravity 1/6g ballistic collection flight toward the Rover's sample hopper
    if (flyProgressRef.current !== null && specimenRef.current) {
      flyProgressRef.current = Math.min(1, flyProgressRef.current + dt / 0.85);
      const p = flyProgressRef.current;
      const roverPos = roverPosRef.current;
      const start = startFlyWorldRef.current;
      const targetX = roverPos ? roverPos.x : start.x;
      const targetY = (roverPos ? roverPos.y : start.y) + 0.85;
      const targetZ = roverPos ? roverPos.z : start.z;

      const arcLift = 3.2 * 4 * p * (1 - p);
      specimenRef.current.position.set(
        THREE.MathUtils.lerp(start.x, targetX, p),
        THREE.MathUtils.lerp(start.y, targetY, p) + arcLift,
        THREE.MathUtils.lerp(start.z, targetZ, p),
      );
      specimenRef.current.rotation.x += dt * 7.5;
      specimenRef.current.rotation.y += dt * 9.2;
      specimenRef.current.scale.setScalar(THREE.MathUtils.lerp(1.15, 0.22, p));

      if (p >= 1) {
        flyProgressRef.current = null;
        doneFlyingRef.current = true;
        specimenRef.current.visible = false;
      }
    }
  });

  const baseRingScale = isNearby ? 1.12 : 1;
  const isGenesis = site.spec.id === 'genesis_rock';

  return (
    <>
      <group position={[site.position.x, site.position.y, site.position.z]}>
        {/* Ground locator halo */}
        {!isCollected && (
          <mesh quaternion={ringQuat} position={[0, 0.08, 0]} scale={[baseRingScale, baseRingScale, 1]}>
            <ringGeometry args={[isGenesis ? 3.9 : 2.3, isGenesis ? 4.35 : 2.65, 40]} />
            <meshBasicMaterial
              color={isNearby ? '#4ade80' : site.spec.ringColor}
              transparent
              opacity={isNearby ? 0.92 : 0.65}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}

        {/* Comical dust splash shockwave on fumble */}
        <mesh ref={dustRingRef} quaternion={ringQuat} position={[0, 0.11, 0]} visible={false}>
          <ringGeometry args={[0.9, 1.45, 28]} />
          <meshBasicMaterial
            ref={dustMatRef}
            color="#d1d5db"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Pedestal rock & Spur Crater beacon for Genesis Rock (Exploration Site 1) */}
        {isGenesis && pedestalGeo && (
          <>
            <mesh geometry={pedestalGeo} position={[0, 0.24, 0]} castShadow receiveShadow>
              <meshStandardMaterial color="#585e68" roughness={0.92} metalness={0.05} />
            </mesh>
            <mesh position={[1.4, 1.65, -0.6]} castShadow>
              <cylinderGeometry args={[0.06, 0.08, 3.3, 10]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.75} roughness={0.35} />
            </mesh>
            <mesh position={[1.95, 2.85, -0.6]} castShadow>
              <boxGeometry args={[1.05, 0.62, 0.05]} />
              <meshStandardMaterial color="#1d4ed8" metalness={0.2} roughness={0.65} />
            </mesh>
            <mesh ref={beaconPulseRef} position={[1.4, 3.45, -0.6]}>
              <sphereGeometry args={[0.24, 16, 16]} />
              <meshBasicMaterial color={isCollected ? '#34d399' : '#fde047'} />
            </mesh>
          </>
        )}

        {/* Supporting rubble / vesicular pores around non-Genesis sites */}
        {!isGenesis && (
          <mesh
            geometry={chipGeo}
            position={[0.72, sampler.getHeight(site.position.x + 0.72, site.position.z + 0.45) - site.position.y + 0.09, 0.45]}
            rotation={[0.4, 0.9, 0.2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={site.spec.id === 'anorthosite' ? '#bcc4d0' : '#434852'}
              roughness={0.85}
              metalness={0.08}
            />
          </mesh>
        )}
      </group>

      {/* The actual collectible rock specimen (lifts off into Rover basket when snatched!) */}
      <group
        ref={specimenRef}
        position={[
          site.position.x,
          site.position.y + (isGenesis ? 0.52 : 0.32),
          site.position.z,
        ]}
      >
        <mesh geometry={rockGeo} castShadow receiveShadow>
          {site.spec.id === 'solid_basalt' && (
            <meshStandardMaterial color="#343840" roughness={0.62} metalness={0.18} />
          )}
          {site.spec.id === 'vesicular_basalt' && (
            <meshStandardMaterial color="#525864" roughness={0.95} metalness={0.05} />
          )}
          {site.spec.id === 'anorthosite' && (
            <meshStandardMaterial
              color="#dce2ec"
              roughness={0.42}
              metalness={0.14}
              emissive="#1e293b"
              emissiveIntensity={0.28}
            />
          )}
          {site.spec.id === 'genesis_rock' && (
            <meshStandardMaterial
              color="#f8fafc"
              roughness={0.34}
              metalness={0.08}
              emissive="#fef08a"
              emissiveIntensity={0.42}
            />
          )}
        </mesh>

        {/* Pitted gas-vesicle dimples on Vesicular Basalt */}
        {site.spec.id === 'vesicular_basalt' && (
          <>
            <mesh position={[0.35, 0.2, 0.32]}>
              <sphereGeometry args={[0.08, 8, 8]} />
              <meshStandardMaterial color="#1f2329" roughness={1} />
            </mesh>
            <mesh position={[-0.28, 0.26, 0.34]}>
              <sphereGeometry args={[0.07, 8, 8]} />
              <meshStandardMaterial color="#1f2329" roughness={1} />
            </mesh>
            <mesh position={[0.12, 0.36, -0.29]}>
              <sphereGeometry args={[0.09, 8, 8]} />
              <meshStandardMaterial color="#1f2329" roughness={1} />
            </mesh>
          </>
        )}
      </group>
    </>
  );
}

export function buildWorldRockSites(sampler: TerrainSampler): WorldRockSite[] {
  return LUNAR_ROCK_SPECS.map((spec) => {
    const [x, z] = spec.xz;
    return {
      spec,
      position: new THREE.Vector3(x, sampler.getHeight(x, z), z),
      normal: sampler.getNormal(x, z),
    };
  });
}

export function LunarRocks({
  sites,
  sampler,
  roverPosRef,
  collectedSet,
  nearbyRockId,
  fumbleEvent,
  resetNonce,
}: LunarRocksProps) {
  return (
    <>
      {sites.map((site) => (
        <SingleRockNode
          key={site.spec.id}
          site={site}
          sampler={sampler}
          roverPosRef={roverPosRef}
          isCollected={collectedSet.has(site.spec.id)}
          isNearby={nearbyRockId === site.spec.id}
          fumbleNonce={
            fumbleEvent && fumbleEvent.rockId === site.spec.id ? fumbleEvent.nonce : 0
          }
          resetNonce={resetNonce}
        />
      ))}
    </>
  );
}

