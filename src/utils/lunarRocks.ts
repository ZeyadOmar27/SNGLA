export type LunarRockKind =
  | 'solid_basalt'
  | 'vesicular_basalt'
  | 'anorthosite'
  | 'genesis_rock';

export interface LunarRockSpec {
  id: LunarRockKind;
  bagLabel: string;
  name: string;
  shortName: string;
  hint: string;
  funnySuccessQuote: string;
  xz: readonly [number, number];
  ringColor: string;
  swatchColor: string;
}

export const LUNAR_ROCK_SPECS: readonly LunarRockSpec[] = [
  {
    id: 'solid_basalt',
    bagLabel: 'Bag #01',
    name: 'Solid Basalts',
    shortName: 'Solid Basalt',
    hint: 'Dense dark ancient mare lava flow along the southern crater rim',
    funnySuccessQuote: 'Bagged! Feels like a bowling ball... that magically weighs 1/6th on the Moon!',
    xz: [-14, -14],
    ringColor: '#f59e0b',
    swatchColor: '#3f444e',
  },
  {
    id: 'vesicular_basalt',
    bagLabel: 'Bag #02',
    name: 'Vesicular Basalts',
    shortName: 'Vesicular Basalt',
    hint: 'Gas-pitted dark volcanic rock near Hadley Rille edge',
    funnySuccessQuote: 'Swiss-cheese lava stone secured! Even vacuum space kept those ancient bubbles.',
    xz: [-36, -8],
    ringColor: '#a78bfa',
    swatchColor: '#575c68',
  },
  {
    id: 'anorthosite',
    bagLabel: 'Bag #03',
    name: 'Highland Igneous Rocks (Anorthosites)',
    shortName: 'Anorthosite',
    hint: 'Pale sparkling plagioclase highland rock north of the valley',
    funnySuccessQuote: 'Oh look at that feldspar shine — basically 4-billion-year-old Moon bling!',
    xz: [-18, -42],
    ringColor: '#38bdf8',
    swatchColor: '#cbd5e1',
  },
  {
    id: 'genesis_rock',
    bagLabel: 'Bag #04',
    name: 'Genesis Rock',
    shortName: 'Genesis Rock',
    hint: 'Exploration Site 1 (Spur Crater): gleaming white clast perched on a grey boulder',
    funnySuccessQuote:
      'JACKPOT!! 4.1-billion-year-old Genesis Rock bagged dust-free — Houston just spilled its coffee!',
    xz: [-48, -48],
    ringColor: '#fde047',
    swatchColor: '#f8fafc',
  },
];

export const FUNNY_FUMBLE_QUOTES: readonly string[] = [
  'WHOOPS! Tongs slipped and catapulted Moon dust everywhere — shake off your suit and swing again!',
  'CLANG! You poked the boulder instead of snatching it. Steady those bulky spacesuit gloves!',
  'POOF! Regolith splash! Good thing bags are numbered so we don’t accidentally bag plain dirt.',
  'BOING! Low-gravity rebound — it practically hopped out of your tongs! Snap right in the green zone!',
];

