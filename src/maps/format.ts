/**
 * Curated skirmish map description format.
 *
 * A map is a square of `size` cells described by an ordered list of *features* (shapes that paint
 * terrain, forests or ore) authored once for the first player's part of the map. The loader
 * replicates every feature through the map's symmetry group, so balanced maps only need a fraction
 * of the description:
 *
 *  - `rot2`    2 players, 180° rotation about the centre (exact on the grid)
 *  - `mirror4` 4 players, mirrored in x and y (exact)
 *  - `rot4`    4 players, 90° pinwheel rotation about the centre (exact)
 *  - `rot3`    3 players, 120° rotation about `center` (approximate on a square grid)
 *  - `none`    no symmetry: every start is authored (custom maps from the editor)
 *  - `mirrorX` 2 players, mirrored left / right (x -> N - x); `mirrorY` top / bottom; `mirrorD` across
 *              the main diagonal (x <-> y) — all exact
 *
 * Shapes have soft, noise-wobbled edges evaluated in the authored frame, so every copy is an exact
 * image of the original. Coordinates are continuous map coordinates (cell (x, y) spans [x, x+1)).
 */
export type Pt = [number, number];
export type Climate = 'temperate' | 'winter' | 'desert';
export type Symmetry = 'rot2' | 'mirror4' | 'rot4' | 'rot3' | 'none' | 'mirrorX' | 'mirrorY' | 'mirrorD';

export type Shape =
  | { circle: Pt; r: number }
  | { ellipse: Pt; rx: number; ry: number; /** degrees, clockwise on screen */ angle?: number }
  /** Thick polyline (rivers, ridges, roads); `w` is the full width. */
  | { path: Pt[]; w: number }
  | { rect: [x0: number, y0: number, x1: number, y1: number] }
  | { poly: Pt[] };

export type FeatureKind =
  | 'water'   // sea, lakes, rivers (impassable to ground units)
  | 'rock'    // cliffs, mesas, mountains (impassable)
  | 'clear'   // carve open ground (removes water / rock / trees)
  | 'sand'
  | 'dirt'
  | 'ford'    // shallow crossing through water (passable sand at the waterline)
  | 'forest'  // trees at `density` on open land
  | 'ore'     // gold ore field
  | 'gems'    // gem field
  // editor brushes (no curated map uses them)
  | 'deforest' // remove trees only
  | 'noore'    // remove ore / gems only
  | 'raise'    // raise the ground by `amount` (height units) in a smooth dome; land only
  | 'lower';   // lower the ground by `amount`; land never sinks below the waterline

export type Feature = Shape & {
  t: FeatureKind;
  /** Edge noise amplitude in cells (default 1.2; 0 = crisp). */
  wobble?: number;
  /** Edge noise frequency (default 0.22). */
  freq?: number;
  /** Forest: fraction of cells with a tree (default 0.72). */
  density?: number;
  /** Ore / gems: richness multiplier (default 1). */
  rich?: number;
  /** Paint only this one copy (no symmetry): decoration in dead corners of rot3 maps. */
  once?: boolean;
  /** Raise / lower: height change at the centre of the shape (default 0.6). */
  amount?: number;
};

export interface BridgeDef {
  /** Any water cell of the crossing; the bridge extends along `axis` over the whole water run. */
  at: Pt;
  /** Direction of travel over the bridge. */
  axis: 'x' | 'y';
}

export interface MapDef {
  id: string;
  name: string;
  /** One-line description for the map picker. */
  desc: string;
  size: number;
  players: number;
  climate: Climate;
  symmetry: Symmetry;
  /** Rotation centre for `rot3` (default: map centre). */
  center?: Pt;
  /** Authored start position(s); the symmetry group produces the rest (players = starts × group size). */
  starts: Pt[];
  /** Terrain the map starts from before features are painted (default clear; `water` for island maps). */
  ground?: 'clear' | 'water' | 'dirt' | 'sand';
  features: Feature[];
  bridges?: BridgeDef[];
  /** Noise seed for edges, forests and relief. */
  seed: number;
  /** Radius around each start kept free of water / rock / trees (default 9.5). */
  clearRadius?: number;
  /** Naval map: every base has shore for a shipyard close by. */
  naval?: boolean;
  /** Short tags shown in the picker (e.g. "Bridges", "Naval"). */
  tags?: string[];
  /** Height multiplier for rock relief (default 1). */
  relief?: number;
  /** Custom (editor) maps: author name and format version of the `.rhmap.json` file. */
  author?: string;
  format?: number;
}

/** What the menu needs to list a map. */
export interface MapInfo {
  id: string;
  name: string;
  desc: string;
  size: number;
  players: number;
  climate: Climate;
  tags: string[];
  naval: boolean;
}
