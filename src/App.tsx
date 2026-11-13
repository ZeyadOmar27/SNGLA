import { Suspense, useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Level1Landing, type LandingTelemetry } from './components/Level1Landing';
import { Level2Rover } from './components/Level2Rover';
import { MissionHud, type ActiveLevel } from './components/MissionHud';
import type { DriveTelemetry } from './components/Rover';

const INITIAL_LANDING_TELEMETRY: LandingTelemetry = {
  altitude: 32,
  verticalSpeed: 0,
  horizontalSpeed: 0,
  slopeDeg: 0,
  fuel: 100,
  status: 'descending',
  failReason: null,
};

const INITIAL_DRIVE_TELEMETRY: DriveTelemetry = {
  speed: 0,
  distanceToSite: 68,
  headingDeg: 0,
  targetBearingDeg: 0,
  reachedSite: false,
};

export function App() {
  const [activeLevel, setActiveLevel] = useState<ActiveLevel>('level1');
  const [level1ResetNonce, setLevel1ResetNonce] = useState(0);
  const [level2ResetNonce, setLevel2ResetNonce] = useState(0);

  const [landingTelemetry, setLandingTelemetry] = useState<LandingTelemetry>(
    INITIAL_LANDING_TELEMETRY,
  );
  const [driveTelemetry, setDriveTelemetry] = useState<DriveTelemetry>(INITIAL_DRIVE_TELEMETRY);

  const handleSelectLevel = useCallback((nextLevel: ActiveLevel) => {
    setActiveLevel(nextLevel);
    if (nextLevel === 'level1') {
      setLandingTelemetry(INITIAL_LANDING_TELEMETRY);
      setLevel1ResetNonce((n) => n + 1);
    } else {
      setDriveTelemetry(INITIAL_DRIVE_TELEMETRY);
      setLevel2ResetNonce((n) => n + 1);
    }
  }, []);

  const handleResetCurrentLevel = useCallback(() => {
    if (activeLevel === 'level1') {
      setLandingTelemetry(INITIAL_LANDING_TELEMETRY);
      setLevel1ResetNonce((n) => n + 1);
    } else {
      setDriveTelemetry(INITIAL_DRIVE_TELEMETRY);
      setLevel2ResetNonce((n) => n + 1);
    }
  }, [activeLevel]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [-6, 42, 10], fov: 62, near: 0.2, far: 1400 }}
      >
        <color attach="background" args={['#02040a']} />
        <fog attach="fog" args={['#02040a', 220, 760]} />

        <ambientLight intensity={0.18} />
        <hemisphereLight args={['#c8d6ef', '#595d65', 0.45]} />
        <directionalLight
          position={[95, 42, 35]}
          intensity={2.4}
          color="#fffcf5"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-normalBias={0.04}
          shadow-bias={-0.0003}
          shadow-radius={2.5}
          shadow-camera-left={-155}
          shadow-camera-right={155}
          shadow-camera-top={155}
          shadow-camera-bottom={-155}
          shadow-camera-near={1}
          shadow-camera-far={280}
        />

        <Environment resolution={256} frames={1}>
          <Lightformer
            form="rect"
            intensity={2.2}
            color="#fffaf0"
            position={[18, 12, 10]}
            scale={[14, 14, 1]}
            target={[0, 0, 0]}
          />
          <Lightformer
            form="rect"
            intensity={0.95}
            color="#b8d0f2"
            position={[-16, 10, -12]}
            scale={[18, 12, 1]}
            target={[0, 0, 0]}
          />
          <Lightformer
            form="ring"
            intensity={0.65}
            color="#cbd5e1"
            position={[0, -10, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[30, 30, 1]}
          />
        </Environment>

        <Suspense fallback={null}>
          {activeLevel === 'level1' ? (
            <Level1Landing resetNonce={level1ResetNonce} onTelemetry={setLandingTelemetry} />
          ) : (
            <Level2Rover resetNonce={level2ResetNonce} onDriveTelemetry={setDriveTelemetry} />
          )}
        </Suspense>
      </Canvas>

      <MissionHud
        activeLevel={activeLevel}
        landingTelemetry={landingTelemetry}
        driveTelemetry={driveTelemetry}
        onSelectLevel={handleSelectLevel}
        onResetCurrentLevel={handleResetCurrentLevel}
      />
    </div>
  );
}

export default App;
