import { useEffect, useMemo } from 'react';
import { Stars, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import terrainUrl from '@assets/Apollo_15_-_Landing_Site.glb?url';
import { getLunarPlankTextures } from '../utils/proceduralTextures';
import {
  buildCleanHadleyGeometry,
  buildHorizonApronGeometry,
  buildTerrainSampler,
  TERRAIN_SCALE,
  TERRAIN_Y_OFFSET,
  type TerrainSampler,
} from '../utils/hadleyTerrain';

interface HadleyTerrainProps {
  onSamplerReady: (sampler: TerrainSampler) => void;
}

/**
 * Cleaned, front-facing Apollo 15 Hadley–Apennine & Hadley Rille 3D terrain
 * with STL baseplate/walls removed, seamless outer lunar horizon skirt,
 * lunar regolith micro-crater PBR shading, and distant lunar starfield.
 */
export function HadleyTerrain({ onSamplerReady }: HadleyTerrainProps) {
  const { scene } = useGLTF(terrainUrl);
  const { map, bumpMap, roughnessMap } = useMemo(() => getLunarPlankTextures(), []);

  const { terrainGeo, apronGeo, sampler } = useMemo(() => {
    let sourceGeo: THREE.BufferGeometry | null = null;
    scene.traverse((child) => {
      if (!sourceGeo && (child as THREE.Mesh).isMesh) {
        sourceGeo = (child as THREE.Mesh).geometry;
      }
    });
    if (!sourceGeo) {
      throw new Error('apollo_15_landing_site.glb contains no mesh geometry.');
    }

    const cleaned = buildCleanHadleyGeometry(sourceGeo);
    const builtSampler = buildTerrainSampler(cleaned);
    const builtApron = buildHorizonApronGeometry(builtSampler);

    return {
      terrainGeo: cleaned,
      apronGeo: builtApron,
      sampler: builtSampler,
    };
  }, [scene]);

  useEffect(() => {
    onSamplerReady(sampler);
  }, [sampler, onSamplerReady]);

  return (
    <>
      <Stars
        radius={460}
        depth={90}
        count={2400}
        factor={3}
        saturation={0}
        fade={false}
        speed={0}
      />

      {/* Real Apollo 15 Hadley–Apennine DEM Surface */}
      <mesh
        geometry={terrainGeo}
        position={[0, TERRAIN_Y_OFFSET, 0]}
        scale={[TERRAIN_SCALE, TERRAIN_SCALE, TERRAIN_SCALE]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          map={map}
          bumpMap={bumpMap}
          bumpScale={0.08}
          roughnessMap={roughnessMap}
          roughness={1}
          metalness={0.02}
          vertexColors
          color="#d2d6de"
        />
      </mesh>

      {/* Seamless outer mare extension blending smoothly to the lunar horizon */}
      <mesh geometry={apronGeo} receiveShadow>
        <meshStandardMaterial
          map={map}
          bumpMap={bumpMap}
          bumpScale={0.06}
          roughnessMap={roughnessMap}
          roughness={1}
          metalness={0.02}
          vertexColors
          color="#c5c9d1"
        />
      </mesh>
    </>
  );
}

useGLTF.preload(terrainUrl);
