import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import lmUrl from '../assets/apollo_lunar_module.glb?url';

export const LM_POSITION: [number, number, number] = [-8, 0, 0];
const LM_FOOTPRINT = 8; // world units between the outer landing pads
export const LM_HALF_EXTENT = 2.2; // collision half-size: roughly the descent-stage body, not the leg span

/**
 * Static Apollo Lunar Module ("Falcon") parked on the plank.
 * The model's ladder faces local +Z; we rotate it to face +X, towards the rover,
 * as if the LRV had just been unloaded from the descent stage.
 */
export function LunarModule() {
  const { scene } = useGLTF(lmUrl);

  const lm = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    clone.scale.setScalar(LM_FOOTPRINT / Math.max(size.x, size.z, 0.001));

    // Center on x/z and rest the landing pads exactly on y = 0
    clone.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(clone);
    const center = scaled.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, -scaled.min.y, -center.z);
    return clone;
  }, [scene]);

  return (
    <group position={LM_POSITION} rotation={[0, Math.PI / 2, 0]}>
      <primitive object={lm} />
    </group>
  );
}

useGLTF.preload(lmUrl);
