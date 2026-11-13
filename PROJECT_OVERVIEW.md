# Apollo 15 – 3D Game (Web) – Project Overview

A browser-based 3D game built with web technologies, based on the Apollo 15 script (`Apollo_15_261113_125623.pdf`).
Current state: a **playable prototype**. A lunar rover (LRV) drives with WASD on a plank, next to a parked Apollo Lunar Module.

---

## 1. Decisions made

| Topic | Decision |
|---|---|
| Platform | Web (desktop/mobile browsers) |
| Genre | 3D story-driven space experience (Apollo 15) with small gameplay moments |
| Language / UI | TypeScript + React |
| 3D | Three.js through React Three Fiber |
| Asset format | `.glb` (binary glTF) |

> **Note on the script:** the PDF could not be read by the assistant (unsupported format here).
> Any chapter/scene breakdown discussed earlier was an assumption. Verify it against the PDF.

---

## 2. Tech stack

| Role | Library |
|---|---|
| Build / dev server | `vite` |
| UI | `react`, `react-dom`, `typescript` |
| 3D | `three`, `@types/three`, `@react-three/fiber`, `@react-three/drei` |
| Post-processing (installed, not used yet) | `@react-three/postprocessing`, `postprocessing` |
| Physics (installed, not used yet) | `@react-three/rapier` |
| State (installed, not used yet) | `zustand` |
| Animation (installed, not used yet) | `gsap` |
| Audio (installed, not used yet) | `howler`, `@types/howler` |
| Styling / icons (installed, not used yet) | `tailwindcss`, `@tailwindcss/vite`, `lucide-react` |
| Required by drei | `hls.js` |

Install with `npm install --legacy-peer-deps` (peer-dependency conflicts).

---

## 3. What is implemented

| File | Purpose |
|---|---|
| `src/App.tsx` | Full-screen `<Canvas>`, starfield, sunlight with shadows, controls HUD |
| `src/components/Plank.tsx` | 32 × 36 platform, top surface at `y = 0`, grid overlay |
| `src/components/Rover.tsx` | Loads `lunar_Rover.glb`, auto-scales and centers it, WASD driving, third-person follow camera, plank bounds, collision with the Lunar Module |
| `src/components/LunarModule.tsx` | Loads the Apollo Lunar Module, scales it to about 8 units across, parks it at `x = -8` with its ladder facing the rover |
| `src/assets/lunar_Rover.glb` | Rover model (about 50 MB, stored with Git LFS) |
| `src/assets/apollo_lunar_module.glb` | Lunar Module model (about 0.7 MB) |

### Controls

| Key | Action |
|---|---|
| `W` / `S` (or Up / Down) | Drive forward / reverse |
| `A` / `D` (or Left / Right) | Steer left / right |
| `R` | Reset position |

### Tuning values

| Value | Where | Meaning |
|---|---|---|
| `Math.PI / 2` rotation on the rover model group | `Rover.tsx` | Makes the rover's front face the driving direction |
| `ROVER_RADIUS` (0.8) | `Rover.tsx` | Rover size used for collision |
| `LM_HALF_EXTENT` (2.2) | `LunarModule.tsx` | Half-size of the Lunar Module's collision box (the "barrier") |
| `LM_POSITION` (`[-8, 0, 0]`) | `LunarModule.tsx` | Where the Lunar Module sits |
| `Math.PI / 2` rotation on the Lunar Module group | `LunarModule.tsx` | Turns its ladder (local +Z) toward +X |

---

## 4. History and problems solved

| Problem | Fix |
|---|---|
| Dev error: `Failed to resolve import "hls.js"` | Installed `hls.js` |
| `npm install` peer-dependency error | Used `--legacy-peer-deps` |
| Rolldown "Cannot find native binding" | Reinstalled dependencies from the network |
| Rover drove sideways | Rotated the model 90° |
| Rover wouldn't move | A test cutscene was blocking input; the cutscene was removed |
| Barrier around the Lunar Module too large | Collision box shrunk to the body size |

**Cutscene:** an intro cutscene (camera fly-over, title card, Arabic/English subtitles) was built as a test and then **removed** at your request.
It can be rebuilt with `gsap` and `zustand` (both already installed).

---

## 5. Git / GitHub

- Repository: https://github.com/ZeyadOmar27/SNGLA
- Work branch: **`feature/rover-wasd-prototype`**, created from `origin/main`. **`main` is never pushed to.**
- The remote already contains `Assets/` (`lunar_Rover.glb`, `mars.glb`, `moon.glb`, `opportunity.glb`) and `main.html`.
- **Git LFS** is set up for `src/assets/*.glb` only (`.gitattributes`). The `Assets/` folder is untouched.
- The local commit stores the rover with LFS but is **not pushed yet**. Pushing it needs
  `git push --force-with-lease origin feature/rover-wasd-prototype` (feature branch only), because the first push already contained the file without LFS.
- **Uncommitted work:** Lunar Module, plank width, collision, and this document. `Assets/Apollo_ Lunar_ Module.glb` is untracked.

---

## 6. Run it

```bash
cd "d:\NASA APP"
npm install --legacy-peer-deps
npm run dev      # development server
npm run build    # type-check + production build
```

The first load is slow because the rover model is about 50 MB.

---

## 7. Next steps

1. **Compress the rover model** (50 MB is heavy for the web):
   `npx @gltf-transform/cli optimize src/assets/lunar_Rover.glb public/models/lunar_rover.glb --compress draco --texture-compress webp`
2. Verify the script against the PDF and write the narration and scenes into a data file.
3. Add a scene director (`zustand`) and cutscenes (`gsap`) when the script is confirmed.
4. Add Arabic RTL subtitles and title cards if needed (`dir="rtl"`).
5. Replace the plank with lunar terrain, dust particles and low gravity (1.62 m/s²).
6. Add audio (`howler`).
7. Remove the duplicate rover file (`Assets/` vs `src/assets/`).
