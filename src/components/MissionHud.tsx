import { Check, Compass, Flag, Fuel, Gauge, Navigation, RotateCcw, Rocket } from 'lucide-react';
import { LUNAR_ROCK_SPECS, type LunarRockKind } from '../utils/lunarRocks';
import type { DriveTelemetry } from './Rover';
import type { LandingTelemetry } from './Level1Landing';

export type ActiveLevel = 'level1' | 'level2';

export interface ToastNotice {
  id: number;
  tone: 'success' | 'fumble';
  title: string;
  body: string;
}

export interface MissionHudProps {
  activeLevel: ActiveLevel;
  landingTelemetry: LandingTelemetry;
  driveTelemetry: DriveTelemetry;
  collectedSet: ReadonlySet<LunarRockKind>;
  cleanGrabs: number;
  fumbles: number;
  toast: ToastNotice | null;
  tongsCursorRef: React.RefObject<HTMLDivElement | null>;
  onAttemptGrab: () => void;
  onSelectLevel: (level: ActiveLevel) => void;
  onResetCurrentLevel: () => void;
}

function getSlopeTone(slopeDeg: number): { label: string; colorClass: string; barClass: string } {
  if (slopeDeg <= 8) {
    return {
      label: 'FLAT / SAFE',
      colorClass: 'text-emerald-400',
      barClass: 'bg-emerald-400',
    };
  }
  if (slopeDeg <= 12.5) {
    return {
      label: 'MARGINAL',
      colorClass: 'text-amber-400',
      barClass: 'bg-amber-400',
    };
  }
  return {
    label: 'TOO STEEP',
    colorClass: 'text-rose-400',
    barClass: 'bg-rose-500',
  };
}

export function MissionHud({
  activeLevel,
  landingTelemetry,
  driveTelemetry,
  collectedSet,
  cleanGrabs,
  fumbles,
  toast,
  tongsCursorRef,
  onAttemptGrab,
  onSelectLevel,
  onResetCurrentLevel,
}: MissionHudProps) {
  const slopeTone = getSlopeTone(landingTelemetry.slopeDeg);
  const nearbySpec = driveTelemetry.nearbyRockId
    ? LUNAR_ROCK_SPECS.find((s) => s.id === driveTelemetry.nearbyRockId) ?? null
    : null;
  const allCollected = collectedSet.size >= LUNAR_ROCK_SPECS.length;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 text-slate-100 select-none">
      {/* Top Bar: Separated Level Switcher + Per-Level Telemetry */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: Separated Level Selector */}
        <div className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/80 p-2.5 backdrop-blur-md">
          <div className="flex items-center gap-2 px-1 text-[11px] font-semibold tracking-widest text-sky-300 uppercase">
            <Rocket className="h-3.5 w-3.5" />
            <span>Apollo 15 • Hadley–Apennine</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onSelectLevel('level1');
              }}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                activeLevel === 'level1'
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              Level 1: Falcon Landing
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onSelectLevel('level2');
              }}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                activeLevel === 'level2'
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              Level 2: Lunar Rover
            </button>
          </div>
        </div>

        {/* Right: Active Level Telemetry */}
        {activeLevel === 'level1' ? (
          <div className="w-72 rounded-xl border border-white/10 bg-slate-950/80 p-3.5 backdrop-blur-md">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <div className="text-[10px] tracking-wider text-slate-400 uppercase">Altitude</div>
                <div className="font-mono text-base font-semibold text-white">
                  {landingTelemetry.altitude.toFixed(1)}{' '}
                  <span className="text-xs text-slate-400">m</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] tracking-wider text-slate-400 uppercase">
                  Descent Speed
                </div>
                <div
                  className={`font-mono text-base font-semibold ${
                    landingTelemetry.verticalSpeed > 3.4 ? 'text-rose-400' : 'text-emerald-300'
                  }`}
                >
                  {landingTelemetry.verticalSpeed.toFixed(1)}{' '}
                  <span className="text-xs text-slate-400">m/s</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] tracking-wider text-slate-400 uppercase">
                  Drift Speed
                </div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    landingTelemetry.horizontalSpeed > 2.6 ? 'text-amber-300' : 'text-slate-200'
                  }`}
                >
                  {landingTelemetry.horizontalSpeed.toFixed(1)}{' '}
                  <span className="text-xs text-slate-400">m/s</span>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] tracking-wider text-slate-400 uppercase">
                  <Fuel className="h-3 w-3" />
                  <span>Fuel</span>
                </div>
                <div className="font-mono text-sm font-semibold text-sky-300">
                  {landingTelemetry.fuel.toFixed(0)}%
                </div>
              </div>
            </div>

            <div className="mt-3 border-t border-white/10 pt-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Ground Slope (مؤشر الميل)</span>
                <span className={`font-mono font-semibold ${slopeTone.colorClass}`}>
                  {landingTelemetry.slopeDeg.toFixed(1)}° • {slopeTone.label}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all duration-100 ${slopeTone.barClass}`}
                  style={{ width: `${Math.min(100, (landingTelemetry.slopeDeg / 20) * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                Target flat mare: ≤ 12.5° slope, ≤ 3.4 m/s impact
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 backdrop-blur-md">
                <div>
                  <div className="flex items-center gap-1 text-[10px] tracking-wider text-slate-400 uppercase">
                    <Gauge className="h-3 w-3" />
                    <span>Speed</span>
                  </div>
                  <div className="font-mono text-base font-semibold text-white">
                    {driveTelemetry.speed.toFixed(1)}{' '}
                    <span className="text-xs text-slate-400">m/s</span>
                  </div>
                </div>

                <div className="h-8 w-px bg-white/10" />

                <div>
                  <div className="flex items-center gap-1 text-[10px] tracking-wider text-slate-400 uppercase">
                    <Flag className="h-3 w-3 text-sky-300" />
                    <span>{driveTelemetry.targetLabel}</span>
                  </div>
                  <div className="font-mono text-base font-semibold text-sky-300">
                    {allCollected ? 'Done' : `${driveTelemetry.distanceToSite.toFixed(1)} m`}
                  </div>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-sky-400/35 bg-sky-500/10">
                  <Navigation
                    className="h-5 w-5 text-sky-300 transition-transform duration-75"
                    style={{ transform: `rotate(${driveTelemetry.targetBearingDeg}deg)` }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onResetCurrentLevel();
                }}
                className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-950/80 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800/90"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            </div>

            {/* Numbered Apollo 15 Sample Bag Manifest */}
            <div className="w-72 rounded-xl border border-white/10 bg-slate-950/80 p-3 backdrop-blur-md">
              <div className="flex items-center justify-between text-[11px] font-semibold tracking-wider text-amber-300 uppercase">
                <span>Lunar Rock Samples</span>
                <span className="font-mono text-white">
                  {collectedSet.size} / {LUNAR_ROCK_SPECS.length}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {LUNAR_ROCK_SPECS.map((spec) => {
                  const bagged = collectedSet.has(spec.id);
                  const active = driveTelemetry.nearbyRockId === spec.id;
                  return (
                    <div
                      key={spec.id}
                      className={`flex items-center justify-between rounded-lg px-2 py-1 text-xs transition ${
                        bagged
                          ? 'bg-emerald-500/15 text-emerald-200'
                          : active
                            ? 'bg-sky-500/20 text-sky-100 ring-1 ring-sky-400/50'
                            : 'bg-white/5 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
                          style={{ backgroundColor: spec.swatchColor }}
                        />
                        <span className="font-mono text-[10px] text-slate-400">
                          {spec.bagLabel}
                        </span>
                        <span className="truncate font-medium">{spec.name}</span>
                      </div>
                      {bagged && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Center Modals (Per-Level Outcomes + Comic Astronaut Radio Quip Toast) */}
      <div className="flex flex-col items-center justify-center gap-3">
        {activeLevel === 'level2' && toast && !allCollected && (
          <div
            className={`max-w-md rounded-xl border px-4 py-2.5 text-center text-xs shadow-lg backdrop-blur-md ${
              toast.tone === 'success'
                ? 'border-emerald-400/40 bg-emerald-950/85 text-emerald-100'
                : 'border-amber-400/40 bg-amber-950/85 text-amber-100'
            }`}
          >
            <div className="font-bold tracking-wide uppercase">{toast.title}</div>
            <div className="mt-0.5 text-[11px] opacity-90">{toast.body}</div>
          </div>
        )}

        {activeLevel === 'level1' && landingTelemetry.status === 'landed' && (
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-400/35 bg-slate-950/90 p-5 text-center shadow-2xl backdrop-blur-md">
            <div className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">
              Contact Light • Level 1 Complete
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">Falcon Has Landed at Hadley</h2>
            <p className="mt-2 text-xs text-slate-300">
              Touchdown slope {landingTelemetry.slopeDeg.toFixed(1)}° • Impact{' '}
              {landingTelemetry.verticalSpeed.toFixed(1)} m/s
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSelectLevel('level2');
                }}
                className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Play Level 2: Lunar Rover →
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onResetCurrentLevel();
                }}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                Replay Level 1
              </button>
            </div>
          </div>
        )}

        {activeLevel === 'level1' && landingTelemetry.status === 'crashed' && (
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-950/90 p-5 text-center shadow-2xl backdrop-blur-md">
            <div className="text-xs font-semibold tracking-widest text-rose-400 uppercase">
              Touchdown Abort
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">Hard Impact on Hadley Surface</h2>
            <p className="mt-2 text-xs text-rose-200">{landingTelemetry.failReason}</p>
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onResetCurrentLevel();
              }}
              className="mt-4 rounded-xl bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400"
            >
              Retry Level 1 (R)
            </button>
          </div>
        )}

        {activeLevel === 'level2' && allCollected && (
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-400/40 bg-slate-950/90 p-5 text-center shadow-2xl backdrop-blur-md">
            <div className="text-xs font-semibold tracking-widest text-yellow-300 uppercase">
              All 4 Sample Bags Sealed • Level 2 Complete
            </div>
            <h2 className="mt-1 text-xl font-bold text-white">
              Genesis Rock & Apollo 15 Haul Bagged!
            </h2>
            <p className="mt-2 text-xs text-slate-300">
              Clean Tongs Grabs: {cleanGrabs} • Dust Sneezes: {fumbles}
              {fumbles === 0
                ? ' — Surgeon-level spacesuit precision!'
                : ' — Only slightly dusty on the moon boots!'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onResetCurrentLevel();
                }}
                className="rounded-xl bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
              >
                Collect Again (R)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSelectLevel('level1');
                }}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                Back to Level 1
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Interactive Apollo Tongs Grab Bar + Controls Legend */}
      <div className="flex flex-col items-center gap-2.5">
        {activeLevel === 'level2' && nearbySpec && !allCollected && (
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-emerald-400/40 bg-slate-950/90 p-3.5 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div>
                <span className="font-mono text-[10px] font-bold text-amber-300 uppercase">
                  {nearbySpec.bagLabel} Ready
                </span>
                <div className="font-bold text-white">{nearbySpec.name}</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onAttemptGrab();
                }}
                className="rounded-xl bg-emerald-400 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-300"
              >
                Snap Tongs! (Space)
              </button>
            </div>

            <div className="mt-2.5">
              <div className="relative h-4 w-full overflow-hidden rounded-full border border-white/15 bg-slate-800">
                {/* Outer dust splash zones */}
                <div className="absolute inset-0 bg-amber-500/20" />
                {/* Center sweet-spot clean grab zone: [30%..70%] */}
                <div
                  className="absolute inset-y-0 border-x border-emerald-300/60 bg-emerald-500/45"
                  style={{ left: '30%', width: '40%' }}
                />
                {/* Moving tongs claw needle */}
                <div
                  ref={tongsCursorRef}
                  className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_#fff]"
                  style={{ left: '50%' }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>Dust Splash</span>
                <span className="font-semibold text-emerald-300">
                  Hit Green Zone with Space — keep sample dust-free!
                </span>
                <span>Dust Splash</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-white/10 bg-slate-950/75 px-4 py-2 text-[11px] text-slate-300 backdrop-blur-md">
          {activeLevel === 'level1' ? (
            <>
              <span>
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">Space</kbd>{' '}
                / <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">E</kbd>{' '}
                Main Thruster
              </span>
              <span>•</span>
              <span>
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">W A S D</kbd>{' '}
                RCS Maneuver
              </span>
              <span>•</span>
              <span>
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">R</kbd>{' '}
                Restart
              </span>
              <span>•</span>
              <span>Scroll Zoom</span>
            </>
          ) : (
            <>
              <span>
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">W A S D</kbd>{' '}
                / Arrows Drive
              </span>
              <span>•</span>
              <span>
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">Space</kbd>{' '}
                Snap Tongs Near Stone
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Compass className="h-3 w-3 text-sky-300" /> Follow Compass to 4 Stones
              </span>
              <span>•</span>
              <span>
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-white">R</kbd>{' '}
                Reset Rover
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
