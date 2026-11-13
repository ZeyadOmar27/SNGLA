import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { Plank } from './components/Plank';
import { Rover } from './components/Rover';
import { LunarModule } from './components/LunarModule';

function App() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <Canvas
        shadows
        camera={{ position: [0, 4.2, 8.5], fov: 50, near: 0.1, far: 500 }}
      >
        <color attach="background" args={['#05070d']} />
        <Stars radius={120} depth={50} count={3000} factor={3} fade />

        {/* Harsh lunar-style sunlight + subtle fill */}
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[18, 25, 14]}
          intensity={2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={25}
          shadow-camera-bottom={-25}
          shadow-camera-near={1}
          shadow-camera-far={80}
        />

        <Plank />

        <Suspense fallback={null}>
          <LunarModule />
          <Rover />
        </Suspense>
      </Canvas>

      {/* Minimalist Controls HUD */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          padding: '12px 16px',
          borderRadius: 10,
          background: 'rgba(10, 14, 24, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(8px)',
          fontSize: 13,
          lineHeight: 1.6,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4, color: '#fff' }}>
          Lunar Rover Controls
        </div>
        <div>
          <strong>W / S</strong> — Drive Forward / Reverse
        </div>
        <div>
          <strong>A / D</strong> — Steer Left / Right
        </div>
        <div>
          <strong>R</strong> — Reset Position
        </div>
      </div>
    </div>
  );
}

export default App;
