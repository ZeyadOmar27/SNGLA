import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainSampler } from '../utils/hadleyTerrain';

const PARTICLE_COUNT = 90;
const LUNAR_DUST_GRAVITY = 1.62;

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  size: number;
}

interface LunarDustProps {
  roverPosRef: React.RefObject<THREE.Vector3>;
  roverHeadingRef: React.RefObject<number>;
  roverSpeedRef: React.RefObject<number>;
  sampler: TerrainSampler;
}

/**
 * Low-gravity ballistic regolith dust kicked up by the LRV wheels.
 * Without atmosphere, dust grains follow clean parabolic arcs under 1.62 m/s² gravity.
 */
export function LunarDust({
  roverPosRef,
  roverHeadingRef,
  roverSpeedRef,
  sampler,
}: LunarDustProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const spawnAccum = useRef(0);
  const cursor = useRef(0);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => ({
        active: false,
        pos: new THREE.Vector3(0, -999, 0),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 1.4,
        size: 1,
      })),
    [],
  );

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const mesh = meshRef.current;
    if (!mesh) return;

    const speed = roverSpeedRef.current;
    const absSpeed = Math.abs(speed);

    // Emit dust behind left/right rear wheels proportional to rover speed
    if (absSpeed > 0.6) {
      spawnAccum.current += absSpeed * dt * 7;
      const rPos = roverPosRef.current;
      const h = roverHeadingRef.current;
      const fx = -Math.sin(h);
      const fz = -Math.cos(h);
      const rx = Math.cos(h);
      const rz = -Math.sin(h);
      const wheelDir = speed >= 0 ? -1 : 1;

      while (spawnAccum.current >= 1) {
        spawnAccum.current -= 1;
        const p = particles[cursor.current];
        cursor.current = (cursor.current + 1) % PARTICLE_COUNT;

        const side = Math.random() < 0.5 ? -0.95 : 0.95;
        const sx = rPos.x + fx * wheelDir * 0.9 + rx * side + (Math.random() - 0.5) * 0.25;
        const sz = rPos.z + fz * wheelDir * 0.9 + rz * side + (Math.random() - 0.5) * 0.25;
        const sy = sampler.getHeight(sx, sz) + 0.12;

        p.active = true;
        p.pos.set(sx, sy, sz);
        p.vel.set(
          fx * wheelDir * (0.8 + absSpeed * 0.25) + (Math.random() - 0.5) * 0.8,
          1.1 + absSpeed * 0.18 + Math.random() * 0.7,
          fz * wheelDir * (0.8 + absSpeed * 0.25) + (Math.random() - 0.5) * 0.8,
        );
        p.age = 0;
        p.maxAge = 1.1 + Math.random() * 0.9;
        p.size = 0.65 + Math.random() * 0.9;
      }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      if (!p.active) {
        dummy.position.set(0, -999, 0);
        dummy.scale.setScalar(0);
      } else {
        p.age += dt;
        p.vel.y -= LUNAR_DUST_GRAVITY * dt;
        p.pos.addScaledVector(p.vel, dt);

        const groundY = sampler.getHeight(p.pos.x, p.pos.z);
        if (p.pos.y <= groundY || p.age >= p.maxAge) {
          p.active = false;
          dummy.scale.setScalar(0);
        } else {
          const lifeFade = 1 - p.age / p.maxAge;
          dummy.position.copy(p.pos);
          dummy.rotation.set(p.age * 2, p.age * 1.5, 0);
          dummy.scale.setScalar(p.size * lifeFade);
        }
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]} frustumCulled={false}>
      <dodecahedronGeometry args={[0.055, 0]} />
      <meshStandardMaterial color="#8b8e94" roughness={0.96} metalness={0.02} />
    </instancedMesh>
  );
}

