import * as THREE from 'three';
import { getFoilBumpTexture, getMicroGrainTexture } from './proceduralTextures';

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
] as const;

export interface PrepareModelOptions {
  /** Target largest horizontal extent (max of X/Z) in world units. */
  targetSize: number;
  /** Maximum WebGL texture anisotropy from renderer capabilities. */
  maxAnisotropy: number;
  /** Optional per-mesh material override run after cloning and default PBR setup. */
  onMaterial?: (mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial, hasUv: boolean) => void;
}

function enhanceTexture(texture: THREE.Texture, maxAnisotropy: number) {
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = Math.min(maxAnisotropy, 16);
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
}

function isWarmFoilColor(color: THREE.Color): boolean {
  return color.r > 0.45 && color.g > 0.22 && color.b < 0.6 && color.r > color.b * 1.35;
}

function applyRealisticPbr(
  rawMat: THREE.Material,
  mesh: THREE.Mesh,
  hasUv: boolean,
  maxAnisotropy: number,
  onMaterial?: PrepareModelOptions['onMaterial'],
): THREE.Material {
  const mat = rawMat.clone();

  if (mat instanceof THREE.MeshStandardMaterial) {
    mat.flatShading = false;
    const name = mat.name.toLowerCase();
    const hasColorMap = Boolean(mat.map);

    if (name.includes('kameralinse') || name.includes('lens')) {
      mat.metalness = 0.15;
      mat.roughness = 0.08;
      mat.envMapIntensity = 1.5;
    } else if (name.includes('seat')) {
      mat.metalness = 0.1;
      mat.roughness = 0.82;
      mat.envMapIntensity = 0.7;
      if (hasColorMap) {
        mat.bumpMap = mat.map;
        mat.bumpScale = 0.012;
      }
    } else if (name.includes('wheel')) {
      mat.metalness = 0.52;
      mat.roughness = 0.46;
      mat.envMapIntensity = 1.0;
      if (hasColorMap) {
        mat.bumpMap = mat.map;
        mat.bumpScale = 0.018;
      }
    } else if (name.includes('antenne') || name.includes('dish')) {
      mat.metalness = 0.78;
      mat.roughness = 0.36;
      mat.envMapIntensity = 1.15;
      if (hasUv) {
        mat.bumpMap = getMicroGrainTexture();
        mat.bumpScale = 0.008;
      }
    } else if (!hasColorMap && isWarmFoilColor(mat.color)) {
      // Crinkled gold/copper Kapton thermal foil on the Lunar Module
      mat.metalness = 0.86;
      mat.roughness = 0.34;
      mat.envMapIntensity = 1.25;
      if (hasUv) {
        mat.bumpMap = getFoilBumpTexture();
        mat.bumpScale = 0.025;
      }
    } else if (hasColorMap) {
      // UV-mapped spacecraft hull, electronics, panels & foil textures
      mat.metalness = 0.42;
      mat.roughness = 0.44;
      mat.envMapIntensity = 1.0;
      mat.bumpMap = mat.map;
      mat.bumpScale = 0.012;
    } else {
      const lum = (mat.color.r + mat.color.g + mat.color.b) / 3;
      if (lum < 0.3) {
        // Dark anodized struts / thruster bell / carbon fittings
        mat.metalness = 0.45;
        mat.roughness = 0.56;
        mat.envMapIntensity = 0.85;
      } else {
        // Brushed aerospace aluminum / titanium
        mat.metalness = 0.68;
        mat.roughness = 0.42;
        mat.envMapIntensity = 1.05;
      }
      if (hasUv) {
        mat.bumpMap = getMicroGrainTexture();
        mat.bumpScale = 0.008;
      }
    }

    if (mat instanceof THREE.MeshPhysicalMaterial) {
      mat.specularIntensity = Math.min(mat.specularIntensity ?? 1, 0.65);
      mat.specularColor.setRGB(
        Math.min(mat.specularColor.r, 1),
        Math.min(mat.specularColor.g, 1),
        Math.min(mat.specularColor.b, 1),
      );
    }

    if (onMaterial) {
      onMaterial(mesh, mat, hasUv);
    }

    for (const slot of TEXTURE_SLOTS) {
      const tex = mat[slot];
      if (tex) enhanceTexture(tex, maxAnisotropy);
    }
  }

  mat.needsUpdate = true;
  return mat;
}

/**
 * Clones a GLTF scene, enables shadows, tunes materials & textures for realistic
 * aerospace PBR shading, scales it to `targetSize`, and grounds `min.y === 0`.
 */
export function prepareAndSoftenModel(
  source: THREE.Object3D,
  { targetSize, maxAnisotropy, onMaterial }: PrepareModelOptions,
): THREE.Object3D {
  const clone = source.clone(true);

  clone.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const hasUv = Boolean(mesh.geometry?.attributes?.uv);
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) =>
        applyRealisticPbr(m, mesh, hasUv, maxAnisotropy, onMaterial),
      );
    } else if (mesh.material) {
      mesh.material = applyRealisticPbr(mesh.material, mesh, hasUv, maxAnisotropy, onMaterial);
    }
  });

  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const maxHoriz = Math.max(size.x, size.z, 0.001);
  clone.scale.setScalar(targetSize / maxHoriz);

  clone.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(clone);
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
  clone.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);

  return clone;
}
