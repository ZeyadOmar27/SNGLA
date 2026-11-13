export const PLANK_WIDTH = 32;
export const PLANK_LENGTH = 36;
export const PLANK_THICKNESS = 0.6;

/**
 * A 3D plank/platform whose top surface sits at y = 0.
 */
export function Plank() {
  return (
    <group>
      {/* Main plank body */}
      <mesh position={[0, -PLANK_THICKNESS / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[PLANK_WIDTH, PLANK_THICKNESS, PLANK_LENGTH]} />
        <meshStandardMaterial color="#6e7278" roughness={0.9} metalness={0.05} />
      </mesh>

      {/* Subtle grid on top of the plank so motion is easy to judge */}
      <gridHelper
        args={[Math.max(PLANK_WIDTH, PLANK_LENGTH), 36, '#9ca3af', '#4b5563']}
        position={[0, 0.005, 0]}
      />
    </group>
  );
}

