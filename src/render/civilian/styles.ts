/**
 * Architecture styles of the civilian buildings, one per `Culture`: the numbers the grammar (index.ts) reads.
 * Colours are sRGB hex. Roofs: see RoofKind. Everything is 1950s and secular (no churches, mosques or temples:
 * towers are water towers, silos, clock and fire towers, wind towers, drum towers).
 */
import type { Culture } from '../../conquest/world/types';

export type RoofKind =
  | 'gable'    // pitched, ridge along the long side
  | 'steep'    // steep pitched (nordic, alpine)
  | 'hip'      // hipped
  | 'tiled'    // low hipped terracotta
  | 'flat'     // flat with a parapet
  | 'mansard'  // steep lower slope, flat top, dormers
  | 'pagoda'   // curved East Asian tiles with lifted eaves
  | 'thatch'   // deep thatch, steep, big overhang
  | 'tin'      // low corrugated iron gable
  | 'layered'; // stacked steep roofs (South-East Asia)

export type TowerKind = 'water-tower' | 'clock-tower' | 'fire-tower' | 'wind-tower' | 'drum-tower' | 'silo' | 'tank-stand' | 'stilt-tower';

export interface Style {
  /** wall colour choices */
  walls: number[];
  /** the detail channel of the walls: 1 = masonry / plaster, 2 = timber / adobe (organic) */
  wallD: 1 | 2;
  /** trim (cornices, bands, frames) */
  trim: number;
  /** plinth / ground course */
  plinth: number;
  /** roof choices for small buildings, and their colours */
  roofs: RoofKind[];
  roofCols: number[];
  /** roof of big civic buildings */
  hallRoof: RoofKind;
  /** storey height (world units) */
  storey: number;
  /** floors of houses and apartment blocks [min, max] */
  houseFloors: [number, number];
  aptFloors: [number, number];
  /** window size (fraction of the storey) and spacing (world units) */
  winW: number;
  winH: number;
  winGap: number;
  /** arched window heads */
  arched?: boolean;
  /** shutter colours (empty: none) */
  shutters: number[];
  /** door colour */
  door: number;
  /** balconies on upper floors */
  balconies?: boolean;
  /** ground-floor arcades on civic buildings / shops */
  arcades?: boolean;
  /** chimneys on pitched roofs */
  chimneys?: boolean;
  /** front porch / verandah on houses */
  porch?: boolean;
  /** houses on stilts */
  stilts?: boolean;
  /** round huts among the houses (share 0..1) */
  huts?: number;
  /** domes on civic buildings (onion = Slavic onion domes on the hall) */
  dome?: 'round' | 'onion';
  /** small domed kiosks on roof corners (chhatris) */
  chhatris?: boolean;
  /** projecting closed balconies (jharokha / mashrabiya) */
  oriels?: boolean;
  /** shop awning colours */
  awnings: number[];
  /** the tower kind */
  tower: TowerKind;
  /** courtyard walls round houses */
  courtyard?: boolean;
  /** dark timber framing on whitewashed walls (corner posts, a beam under the eaves) */
  timber?: number;
}

export const STYLES: Record<Culture, Style> = {
  western: {
    walls: [0x9a4a32, 0x8c4430, 0xa65a3c, 0xbfae8e, 0xcdbb98, 0x7e3e2c],
    wallD: 1, trim: 0xd8d0bc, plinth: 0x6e6a62,
    roofs: ['gable', 'gable', 'mansard', 'hip'], roofCols: [0x4c525a, 0x5a5e66, 0x8e4a34],
    hallRoof: 'mansard', storey: 0.36, houseFloors: [2, 3], aptFloors: [3, 5],
    winW: 0.13, winH: 0.2, winGap: 0.24, shutters: [], door: 0x2a3a52, chimneys: true,
    awnings: [0x7a2a24, 0x2c4a3a, 0x30405e], tower: 'clock-tower',
  },
  nordic: {
    walls: [0x9b2f22, 0xd8b04a, 0xe8e2d4, 0x5a7a8a, 0xb84a2a, 0x2f4a5a],
    wallD: 2, trim: 0xf0ece2, plinth: 0x5e5a54,
    roofs: ['steep', 'steep', 'gable'], roofCols: [0x3a3c40, 0x6e3428, 0x2e3e34],
    hallRoof: 'steep', storey: 0.34, houseFloors: [1, 2], aptFloors: [3, 4],
    winW: 0.12, winH: 0.17, winGap: 0.22, shutters: [], door: 0x3a2a20, chimneys: true,
    awnings: [0x2c4a6a, 0x7a2a24], tower: 'fire-tower',
  },
  slavic: {
    walls: [0xd8c9a2, 0xe2d6b8, 0xc9b48a, 0xa8b49c, 0x8a6a4a, 0xc7a27a],
    wallD: 1, trim: 0xf2eee4, plinth: 0x6a645a,
    roofs: ['gable', 'hip', 'tin'], roofCols: [0x4a6a52, 0x5c5f63, 0x7a3a2c],
    hallRoof: 'hip', storey: 0.36, houseFloors: [1, 2], aptFloors: [4, 6],
    winW: 0.12, winH: 0.19, winGap: 0.22, shutters: [0x3e6e9e, 0x5a8a5a], door: 0x4a3a2a, chimneys: true,
    dome: 'onion', awnings: [0x8a2a24, 0x2c4a6a], tower: 'fire-tower',
  },
  mediterranean: {
    walls: [0xf0ebe0, 0xe8dcc4, 0xf2e6c8, 0xe6c49a, 0xf4f0ea, 0xd9b48a],
    wallD: 1, trim: 0xf6f2ea, plinth: 0x9a8c78,
    roofs: ['tiled', 'tiled', 'flat'], roofCols: [0xa9502e, 0xb8623a, 0x9a4a2a],
    hallRoof: 'tiled', storey: 0.35, houseFloors: [2, 3], aptFloors: [3, 4],
    winW: 0.11, winH: 0.2, winGap: 0.24, shutters: [0x3a6a4a, 0x2f5a8a, 0x6a7a3a], door: 0x5a3a24,
    balconies: true, arcades: true, awnings: [0x2f5a8a, 0xb84a2a, 0x3a6a4a], tower: 'clock-tower',
  },
  'middle-eastern': {
    walls: [0xd8c4a0, 0xcdb48a, 0xe2d2b2, 0xc4a678, 0xe8dcc4, 0xb89a6c],
    wallD: 1, trim: 0xe8dcc0, plinth: 0x9c8a6a,
    roofs: ['flat'], roofCols: [0xb8a07a],
    hallRoof: 'flat', storey: 0.36, houseFloors: [1, 2], aptFloors: [2, 4],
    winW: 0.1, winH: 0.18, winGap: 0.3, arched: true, shutters: [], door: 0x5a3e2a,
    arcades: true, dome: 'round', oriels: true, courtyard: true,
    awnings: [0x9a6a2a, 0x2a5a6a, 0x8a2a24], tower: 'wind-tower',
  },
  african: {
    walls: [0xb07a4e, 0xa86e44, 0xc49264, 0xe6dccb, 0x9a6440],
    wallD: 2, trim: 0xd8ccb6, plinth: 0x6e5038,
    roofs: ['thatch', 'tin', 'tin'], roofCols: [0x9c8350, 0x8c9196, 0x8a5a3c],
    hallRoof: 'hip', storey: 0.34, houseFloors: [1, 1], aptFloors: [2, 3],
    winW: 0.12, winH: 0.16, winGap: 0.3, shutters: [0x3a6a8a, 0x7a5a2a], door: 0x4a3020,
    porch: true, huts: 0.7, awnings: [0x8c9196, 0x2a6a4a], tower: 'tank-stand',
  },
  'south-asian': {
    walls: [0xe8b4a8, 0xe0c060, 0x8cb8c8, 0xc96e4e, 0xf0e6d2, 0xd890b0, 0xa8c890],
    wallD: 1, trim: 0xf2ead8, plinth: 0x8a6e52,
    roofs: ['flat', 'flat', 'tiled'], roofCols: [0xa48a6a, 0xa9502e],
    hallRoof: 'flat', storey: 0.36, houseFloors: [1, 3], aptFloors: [3, 4],
    winW: 0.11, winH: 0.2, winGap: 0.26, arched: true, shutters: [0x3a6a5a, 0x6a3a2a], door: 0x5a3a24,
    balconies: true, oriels: true, chhatris: true, arcades: true,
    awnings: [0xc4502a, 0x2a6a8a, 0xd8a028], tower: 'clock-tower',
  },
  'east-asian': {
    walls: [0xece8de, 0xe4ded0, 0xd9d2c2, 0xeee9df],
    wallD: 1, trim: 0xa8301e, plinth: 0x77736c,
    roofs: ['pagoda'], roofCols: [0x4a4f56, 0x434a50, 0x52565c],
    hallRoof: 'pagoda', storey: 0.34, houseFloors: [1, 1], aptFloors: [2, 3],
    winW: 0.16, winH: 0.15, winGap: 0.16, shutters: [], door: 0x7a2a1c,
    porch: true, timber: 0x3e2a1e, courtyard: true,
    awnings: [0x9a2a24, 0x2a3a5a], tower: 'drum-tower',
  },
  'southeast-asian': {
    walls: [0x8a6a44, 0x7a5a3a, 0xc8b48a, 0xe6dccb, 0x9a7a54],
    wallD: 2, trim: 0x5a4028, plinth: 0x5a4a3a,
    roofs: ['layered', 'thatch', 'tin'], roofCols: [0x8a4a2a, 0x9c8350, 0x8c9196],
    hallRoof: 'layered', storey: 0.33, houseFloors: [1, 1], aptFloors: [2, 3],
    winW: 0.13, winH: 0.15, winGap: 0.24, shutters: [0x5a3a24], door: 0x4a3020,
    stilts: true, porch: true, awnings: [0x2a6a5a, 0xb85a2a], tower: 'stilt-tower',
  },
  'north-american': {
    walls: [0xe8e4da, 0xc8d4dc, 0xe0d4a8, 0x9a4a32, 0xb8c8b0, 0xd8c8b8],
    wallD: 2, trim: 0xf4f2ec, plinth: 0x6a6662,
    roofs: ['gable', 'gable', 'hip'], roofCols: [0x4a4e54, 0x5a3a30, 0x3e4a5a],
    hallRoof: 'flat', storey: 0.35, houseFloors: [1, 2], aptFloors: [4, 7],
    winW: 0.13, winH: 0.19, winGap: 0.24, shutters: [0x2a3a4a, 0x2a4a3a], door: 0x7a2a24,
    porch: true, chimneys: true, awnings: [0xb82a24, 0x2a4a8a, 0x2a6a3a], tower: 'water-tower',
  },
  'latin-american': {
    walls: [0xe8b84a, 0xd86a4a, 0x4a9ab8, 0xe8dcc4, 0x7ab86a, 0xd84a6a, 0xf0e6d2],
    wallD: 1, trim: 0xf6f0e2, plinth: 0x7a6a58,
    roofs: ['flat', 'tiled', 'flat'], roofCols: [0xa9502e, 0xb8623a],
    hallRoof: 'tiled', storey: 0.36, houseFloors: [1, 2], aptFloors: [2, 4],
    winW: 0.11, winH: 0.21, winGap: 0.26, shutters: [0x5a3a24, 0x2a4a6a], door: 0x5a3a24,
    balconies: true, arcades: true, courtyard: true, awnings: [0x2a6a8a, 0xc4502a, 0x3a7a3a], tower: 'clock-tower',
  },
  oceanian: {
    walls: [0xf0ece2, 0xd8e0d4, 0xe8dcc0, 0xb8c8d8, 0xc89a6a],
    wallD: 2, trim: 0xf6f4ee, plinth: 0x6a6460,
    roofs: ['tin', 'hip', 'tin'], roofCols: [0x8c9196, 0x8a4a3a, 0x5a7a6a],
    hallRoof: 'hip', storey: 0.35, houseFloors: [1, 1], aptFloors: [2, 3],
    winW: 0.13, winH: 0.18, winGap: 0.26, shutters: [], door: 0x3a5a6a,
    porch: true, stilts: false, chimneys: true, awnings: [0x8c9196, 0x2a5a6a], tower: 'tank-stand',
  },
};
