import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Level1Landing, type LandingTelemetry } from './components/Level1Landing';
import { Level2Rover } from './components/Level2Rover';
import { MissionHud, type ActiveLevel, type ToastNotice } from './components/MissionHud';
import type { DriveTelemetry } from './components/Rover';
import {
  FUNNY_FUMBLE_QUOTES,
  LUNAR_ROCK_SPECS,
  type LunarRockKind,
} from './utils/lunarRocks';
import { playCleanGrabSfx, playDustFumbleSfx } from './utils/lunarSfx';

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
  distanceToSite: 24,
  targetLabel: 'Solid Basalt (Bag #01)',
  headingDeg: 0,
  targetBearingDeg: 0,
  reachedSite: false,
  nearbyRockId: null,
};

const CLEAN_ZONE_MIN = 0.3;
const CLEAN_ZONE_MAX = 0.7;

export function App() {
  const [activeLevel, setActiveLevel] = useState<ActiveLevel>('level1');
  const [level1ResetNonce, setLevel1ResetNonce] = useState(0);
  const [level2ResetNonce, setLevel2ResetNonce] = useState(0);

  const [landingTelemetry, setLandingTelemetry] = useState<LandingTelemetry>(
    INITIAL_LANDING_TELEMETRY,
  );
  const [driveTelemetry, setDriveTelemetry] = useState<DriveTelemetry>(INITIAL_DRIVE_TELEMETRY);

  const [collectedIds, setCollectedIds] = useState<LunarRockKind[]>([]);
  const [cleanGrabs, setCleanGrabs] = useState(0);
  const [fumbles, setFumbles] = useState(0);
  const [grabSwingNonce, setGrabSwingNonce] = useState(0);
  const [fumbleEvent, setFumbleEvent] = useState<{ rockId: LunarRockKind; nonce: number } | null>(
    null,
  );
  const [toast, setToast] = useState<ToastNotice | null>(null);

  const tongsCursorRef = useRef<HTMLDivElement | null>(null);
  const meterValueRef = useRef(0.5);
  const collectedSet = useMemo(() => new Set(collectedIds), [collectedIds]);

  const resetRockProgress = useCallback(() => {
    setCollectedIds([]);
    setCleanGrabs(0);
    setFumbles(0);
    setGrabSwingNonce(0);
    setFumbleEvent(null);
    setToast(null);
    meterValueRef.current = 0.5;
  }, []);

  const handleSelectLevel = useCallback(
    (nextLevel: ActiveLevel) => {
      setActiveLevel(nextLevel);
      if (nextLevel === 'level1') {
        setLandingTelemetry(INITIAL_LANDING_TELEMETRY);
        setLevel1ResetNonce((n) => n + 1);
      } else {
        resetRockProgress();
        setDriveTelemetry(INITIAL_DRIVE_TELEMETRY);
        setLevel2ResetNonce((n) => n + 1);
      }
    },
    [resetRockProgress],
  );

  const handleResetCurrentLevel = useCallback(() => {
    if (activeLevel === 'level1') {
      setLandingTelemetry(INITIAL_LANDING_TELEMETRY);
      setLevel1ResetNonce((n) => n + 1);
    } else {
      resetRockProgress();
      setDriveTelemetry(INITIAL_DRIVE_TELEMETRY);
      setLevel2ResetNonce((n) => n + 1);
    }
  }, [activeLevel, resetRockProgress]);

  const handleAttemptGrab = useCallback(() => {
    if (activeLevel !== 'level2') return;
    const nearbyId = driveTelemetry.nearbyRockId;
    if (!nearbyId || collectedSet.has(nearbyId)) return;

    setGrabSwingNonce((n) => n + 1);
    const meter = meterValueRef.current;
    const isClean = meter >= CLEAN_ZONE_MIN && meter <= CLEAN_ZONE_MAX;
    const spec = LUNAR_ROCK_SPECS.find((s) => s.id === nearbyId);
    if (!spec) return;

    if (isClean) {
      playCleanGrabSfx(spec.id === 'genesis_rock');
      setCollectedIds((prev) => (prev.includes(spec.id) ? prev : [...prev, spec.id]));
      setCleanGrabs((c) => c + 1);
      setToast({
        id: Date.now(),
        tone: 'success',
        title: `${spec.bagLabel} Sealed — ${spec.shortName}!`,
        body: spec.funnySuccessQuote,
      });
    } else {
      playDustFumbleSfx();
      setFumbles((f) => {
        const nextF = f + 1;
        setToast({
          id: Date.now(),
          tone: 'fumble',
          title: `Dust Splash! (${spec.shortName} slipped!)`,
          body: FUNNY_FUMBLE_QUOTES[(nextF - 1) % FUNNY_FUMBLE_QUOTES.length],
        });
        return nextF;
      });
      setFumbleEvent((prev) => ({ rockId: spec.id, nonce: (prev?.nonce ?? 0) + 1 }));
    }
  }, [activeLevel, driveTelemetry.nearbyRockId, collectedSet]);

  // Animate bouncing tongs timing cursor smoothly ONLY while near an uncollected stone
  useEffect(() => {
    if (
      activeLevel !== 'level2' ||
      !driveTelemetry.nearbyRockId ||
      collectedSet.has(driveTelemetry.nearbyRockId)
    ) {
      return;
    }

    let rafId = 0;
    const startMs = performance.now();

    const tick = (now: number) => {
      const elapsedSec = (now - startMs) / 1000;
      const cycle = (elapsedSec * 1.1) % 2;
      const pos = cycle <= 1 ? cycle : 2 - cycle;
      meterValueRef.current = pos;
      if (tongsCursorRef.current) {
        tongsCursorRef.current.style.left = `${(pos * 100).toFixed(1)}%`;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [activeLevel, driveTelemetry.nearbyRockId, collectedSet]);

  // Trigger grab on Spacebar while in Level 2 near a stone
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && activeLevel === 'level2') {
        if (driveTelemetry.nearbyRockId && !collectedSet.has(driveTelemetry.nearbyRockId)) {
          e.preventDefault();
          handleAttemptGrab();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeLevel, driveTelemetry.nearbyRockId, collectedSet, handleAttemptGrab]);

  // Auto-dismiss transient radio quip toasts cleanly after 3.8s
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
            <Level2Rover
              resetNonce={level2ResetNonce}
              collectedSet={collectedSet}
              nearbyRockId={driveTelemetry.nearbyRockId}
              fumbleEvent={fumbleEvent}
              grabSwingNonce={grabSwingNonce}
              onDriveTelemetry={setDriveTelemetry}
            />
          )}
        </Suspense>
      </Canvas>

      <MissionHud
        activeLevel={activeLevel}
        landingTelemetry={landingTelemetry}
        driveTelemetry={driveTelemetry}
        collectedSet={collectedSet}
        cleanGrabs={cleanGrabs}
        fumbles={fumbles}
        toast={toast}
        tongsCursorRef={tongsCursorRef}
        onAttemptGrab={handleAttemptGrab}
        onSelectLevel={handleSelectLevel}
        onResetCurrentLevel={handleResetCurrentLevel}
      />
    </div>
  );
}

export default App;
