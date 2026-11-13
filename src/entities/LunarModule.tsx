import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import lmUrl from '@assets/Apollo_ Lunar_ Module.glb?url';
import { prepareAndSoftenModel } from '../utils/modelHelpers';
import { getFoilBumpTexture, getMicroGrainTexture } from '../utils/proceduralTextures';

export const LM_POSITION: [number, number, number] = [-8, 0, 0];
export const LM_FOOTPRINT = 8; // world units between the outer landing pads
export const LM_HALF_EXTENT = 2.2; // collision half-size: roughly the descent-stage body, not the leg span

interface MaterialSpec {
  color: string;
  metalness: number;
  roughness: number;
  envMapIntensity?: number;
  bump?: 'foil' | 'grain' | 'map';
  bumpScale?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

/** Authentic Apollo 15 ("Falcon") surface palette keyed by normalized GLB material name. */
const LM_MATERIAL_SPECS: Record<string, MaterialSpec> = {
  // Gold Kapton thermal blanket on descent stage & landing gear
  blinn1sg: {
    color: '#c69234',
    metalness: 0.88,
    roughness: 0.3,
    envMapIntensity: 1.25,
    bump: 'foil',
    bumpScale: 0.03,
  },
  // Burnished copper-amber Kapton lower descent skirt
  blinn9sg: {
    color: '#9e622b',
    metalness: 0.86,
    roughness: 0.32,
    envMapIntensity: 1.2,
    bump: 'foil',
    bumpScale: 0.028,
  },
  // Charcoal/Inconel dark thermal blankets & octagonal panels (replaces flat pitch-black)
  blinn6sg: {
    color: '#272b32',
    metalness: 0.55,
    roughness: 0.44,
    envMapIntensity: 1.0,
    bump: 'foil',
    bumpScale: 0.02,
  },
  // Ascent crew cabin & side propellant pods (replaces Maya default 50% gray)
  initialshadinggr: {
    color: '#8a919b',
    metalness: 0.54,
    roughness: 0.44,
    envMapIntensity: 1.05,
    bump: 'grain',
    bumpScale: 0.008,
  },
  // NASA off-white thermal coating & antenna housings (replaces blown-out #ffffff)
  blinn7sg: {
    color: '#c2c7cf',
    metalness: 0.36,
    roughness: 0.48,
    envMapIntensity: 0.95,
    bump: 'grain',
    bumpScale: 0.008,
  },
  // Brushed aerospace aluminum struts & front ladder
  blinn4sg: {
    color: '#b4bac2',
    metalness: 0.74,
    roughness: 0.36,
    envMapIntensity: 1.1,
    bump: 'grain',
    bumpScale: 0.008,
  },
  // Machined steel/aluminum docking hatch & forward trim
  blinn3sg: {
    color: '#aeb5bf',
    metalness: 0.68,
    roughness: 0.36,
    envMapIntensity: 1.05,
    bump: 'grain',
    bumpScale: 0.008,
  },
  // Dark anodized gunmetal radar mounts, porch grate & structural frames
  blinn2sg: {
    color: '#353a42',
    metalness: 0.64,
    roughness: 0.44,
    envMapIntensity: 0.95,
    bump: 'grain',
    bumpScale: 0.008,
  },
  // Columbium/niobium descent engine bell
  blinn5sg: {
    color: '#9e9ba0',
    metalness: 0.78,
    roughness: 0.38,
    envMapIntensity: 1.1,
    bump: 'map',
    bumpScale: 0.015,
  },
  // USA / mission plaques
  blinn8sg: {
    color: '#e8eaee',
    metalness: 0.2,
    roughness: 0.5,
    envMapIntensity: 0.9,
    bump: 'map',
    bumpScale: 0.008,
  },
  blinn12sg: {
    color: '#e8eaee',
    metalness: 0.2,
    roughness: 0.5,
    envMapIntensity: 0.9,
    bump: 'map',
    bumpScale: 0.008,
  },
  // Warm amber running/tracking lights (replaces lemon-yellow plastic spheres)
  blinn10sg: {
    color: '#d8b263',
    metalness: 0.15,
    roughness: 0.22,
    envMapIntensity: 1.2,
    emissive: '#ffb84d',
    emissiveIntensity: 0.35,
  },
};

const RCS_NOZZLE_SPEC: MaterialSpec = {
  color: '#464b54',
  metalness: 0.82,
  roughness: 0.34,
  envMapIntensity: 1.1,
  bump: 'grain',
  bumpScale: 0.008,
};

function applySpec(
  mat: THREE.MeshStandardMaterial,
  spec: MaterialSpec,
  hasUv: boolean,
) {
  mat.color.set(spec.color);
  mat.metalness = spec.metalness;
  mat.roughness = spec.roughness;
  if (spec.envMapIntensity !== undefined) mat.envMapIntensity = spec.envMapIntensity;

  if (spec.emissive) {
    mat.emissive.set(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity ?? 0.3;
  }

  if (spec.bump === 'map' && mat.map) {
    mat.bumpMap = mat.map;
    mat.bumpScale = spec.bumpScale ?? 0.012;
  } else if (spec.bump === 'foil' && hasUv) {
    mat.bumpMap = getFoilBumpTexture();
    mat.bumpScale = spec.bumpScale ?? 0.025;
  } else if (spec.bump === 'grain' && hasUv) {
    mat.bumpMap = getMicroGrainTexture();
    mat.bumpScale = spec.bumpScale ?? 0.008;
  }
}

export function tuneApolloModuleMaterial(
  mesh: THREE.Mesh,
  mat: THREE.MeshStandardMaterial,
  hasUv: boolean,
) {
  const matKey = mat.name.toLowerCase().replace(/[._]\d+$/, '');
  const meshName = mesh.name.toLowerCase();

  // Separate Ascent RCS thruster nozzles (group13) from the gold Kapton foil they share blinn1SG with
  if (matKey === 'blinn1sg' && meshName.startsWith('group13')) {
    applySpec(mat, RCS_NOZZLE_SPEC, hasUv);
    return;
  }

  const spec = LM_MATERIAL_SPECS[matKey];
  if (spec) {
    applySpec(mat, spec, hasUv);
  }
}

/**
 * Static Apollo Lunar Module ("Falcon") parked on the plank.
 * The model's ladder faces local +Z; we rotate it to face +X, towards the rover,
 * as if the LRV had just been unloaded from the descent stage.
 */
export function LunarModule() {
  const { scene } = useGLTF(lmUrl);
  const gl = useThree((s) => s.gl);

  const lm = useMemo(
    () =>
      prepareAndSoftenModel(scene, {
        targetSize: LM_FOOTPRINT,
        maxAnisotropy: gl.capabilities.getMaxAnisotropy(),
        onMaterial: tuneApolloModuleMaterial,
      }),
    [scene, gl],
  );

  return (
    <group position={LM_POSITION} rotation={[0, Math.PI / 2, 0]}>
      <primitive object={lm} />
    </group>
  );
}

useGLTF.preload(lmUrl);
