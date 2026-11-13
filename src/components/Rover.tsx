import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import roverUrl from '../assets/lunar_Rover.glb?url';
import { PLANK_LENGTH, PLANK_WIDTH } from './Plank';

const TARGET_ROVER_SIZE = 2.8;
const ACCELERATION = 14;
const MAX_SPEED = 9;
const REVERSE_MAX_SPEED = 4.5;
const DAMPING = 5.5;
const TURN_SPEED = 2.2;

interface KeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
}

export function Rover() {
  const { scene } = useGLTF(roverUrl);
  const roverRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const keys = useRef<KeyState>({ w: false, a: false, s: false, d: false });
  const speed = useRef(0);
  const heading = useRef(0);

  const cameraOffset = useMemo(() => new THREE.Vector3(0, 4.2, 8.5), []);
  const desiredCameraPos = useMemo(() => new THREE.Vector3(), []);
  const lookAtTarget = useMemo(() => new THREE.Vector3(), []);

  // Normalize the GLB model so it sits centered on y = 0 at a consistent scale
  const normalizedRover = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxHoriz = Math.max(size.x, size.z, 0.001);
    const scale = TARGET_ROVER_SIZE / maxHoriz;
    clone.scale.setScalar(scale);

    // Recompute bounds after scaling so min.y rests cleanly at y = 0
    clone.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(clone);
    const scaledCenter = new THREE.Vector3();
    scaledBox.getCenter(scaledCenter);

    clone.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);
    return clone;
  }, [scene]);

  useEffect(() => {
    const handleKey = (isDown: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') keys.current.w = isDown;
      if (k === 's' || e.key === 'ArrowDown') keys.current.s = isDown;
      if (k === 'a' || e.key === 'ArrowLeft') keys.current.a = isDown;
      if (k === 'd' || e.key === 'ArrowRight') keys.current.d = isDown;

      if (isDown && k === 'r' && roverRef.current) {
        roverRef.current.position.set(0, 0, 0);
        roverRef.current.rotation.set(0, 0, 0);
        speed.current = 0;
        heading.current = 0;
      }
    };

    const onKeyDown = handleKey(true);
    const onKeyUp = handleKey(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const rover = roverRef.current;
    if (!rover) return;

    const { w, a, s, d } = keys.current;

    // Forward / reverse acceleration
    if (w) {
      speed.current += ACCELERATION * dt;
    } else if (s) {
      speed.current -= ACCELERATION * dt;
    } else {
      // Smoothly damp to a stop when no throttle key is pressed
      speed.current -= speed.current * Math.min(1, DAMPING * dt);
      if (Math.abs(speed.current) < 0.02) speed.current = 0;
    }

    speed.current = THREE.MathUtils.clamp(speed.current, -REVERSE_MAX_SPEED, MAX_SPEED);

    // Steering (invert turn direction when reversing)
    const steerDir = (a ? 1 : 0) - (d ? 1 : 0);
    if (steerDir !== 0) {
      const reverseFactor = speed.current < -0.1 ? -1 : 1;
      heading.current += steerDir * TURN_SPEED * reverseFactor * dt;
    }

    rover.rotation.y = heading.current;

    // Move along local -Z forward vector
    const forwardX = -Math.sin(heading.current);
    const forwardZ = -Math.cos(heading.current);

    rover.position.x += forwardX * speed.current * dt;
    rover.position.z += forwardZ * speed.current * dt;

    // Keep rover on the plank
    const halfW = PLANK_WIDTH / 2 - 1.4;
    const halfL = PLANK_LENGTH / 2 - 1.4;
    rover.position.x = THREE.MathUtils.clamp(rover.position.x, -halfW, halfW);
    rover.position.z = THREE.MathUtils.clamp(rover.position.z, -halfL, halfL);

    // Smooth third-person follow camera
    const rotatedOffset = cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), heading.current);
    desiredCameraPos.copy(rover.position).add(rotatedOffset);
    camera.position.lerp(desiredCameraPos, 1 - Math.exp(-6 * dt));

    lookAtTarget.set(rover.position.x, rover.position.y + 0.8, rover.position.z);
    camera.lookAt(lookAtTarget);
  });

  return (
    <group ref={roverRef} position={[0, 0, 0]}>
      {/* Rotate the GLB model +90° around Y so its front (dish/camera) faces -Z (forward) */}
      <group rotation={[0, Math.PI / 2, 0]}>
        <primitive object={normalizedRover} />
      </group>
    </group>
  );
}

useGLTF.preload(roverUrl);

