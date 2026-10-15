/**
 * Hand-designed skirmish maps. Each map is authored for the first player (and the shared middle);
 * the builder mirrors / rotates every feature for the other players, so all maps are balanced by
 * construction (see format.ts). Coordinates are cells; x grows east, y grows south.
 */
import type { MapDef } from './format';

const provingGrounds: MapDef = {
  id: 'proving-grounds', name: 'Proving Grounds', size: 96, players: 2, climate: 'temperate', symmetry: 'rot2', seed: 1101,
  desc: 'Classic open-field duel: two ore fields at home, a contested gem pit in the middle and forests to flank through.',
  tags: ['Land', '1v1'],
  starts: [[14.5, 81.5]],
  features: [
    // relief and water
    { t: 'water', ellipse: [47, 77], rx: 7.5, ry: 3.6, angle: -18 },
    { t: 'water', circle: [23, 57], r: 3.2 },
    { t: 'rock', path: [[29, 41], [37, 33]], w: 2.6 },
    { t: 'rock', circle: [39, 55], r: 2.3 },
    { t: 'rock', path: [[60, 83], [66, 78]], w: 2.2 },
    { t: 'dirt', path: [[14, 81], [30, 66], [48, 48]], w: 5, wobble: 2 },
    // forests
    { t: 'forest', circle: [19, 29], r: 9, density: 0.8 },
    { t: 'forest', circle: [65, 89], r: 7, density: 0.75 },
    { t: 'forest', path: [[2, 58], [9, 51]], w: 4 },
    { t: 'forest', ellipse: [33, 50], rx: 4, ry: 2.5, angle: 45, density: 0.6 },
    { t: 'forest', circle: [52, 63], r: 6, density: 0.14 },
    { t: 'forest', circle: [4, 92], r: 4, density: 0.5 },
    // ore
    { t: 'ore', circle: [26, 89], r: 3.4 },
    { t: 'ore', circle: [8, 69], r: 3.2 },
    { t: 'ore', circle: [35, 66], r: 4 },
    { t: 'ore', circle: [10, 43], r: 3.4 },
    { t: 'gems', circle: [48, 48], r: 2.8 },
  ],
};

const bridgewater: MapDef = {
  id: 'bridgewater', name: 'Bridgewater', size: 96, players: 2, climate: 'temperate', symmetry: 'rot2', seed: 2207,
  desc: 'A broad river splits the valley. Hold the two bridges and the shallow ford in the middle to control the crossing.',
  tags: ['River', 'Bridges', 'Fords', '1v1'],
  starts: [[14.5, 81.5]],
  features: [
    { t: 'water', path: [[-4, 33], [10, 37], [22, 45], [35, 44], [48, 48]], w: 5.5, wobble: 0.9 },
    { t: 'ford', path: [[46.4, 53.6], [49.6, 42.4]], w: 3.4, wobble: 0.3 },
    { t: 'water', circle: [6, 60], r: 3 },
    { t: 'rock', path: [[30, 56], [38, 59]], w: 2.4 },
    { t: 'rock', circle: [64, 80], r: 2.6 },
    // river-bank woods and the home forest
    { t: 'forest', path: [[0, 44], [12, 47], [16, 52]], w: 5, density: 0.7 },
    { t: 'forest', path: [[26, 51], [34, 50]], w: 3, density: 0.55 },
    { t: 'forest', circle: [70, 92], r: 7, density: 0.78 },
    { t: 'forest', circle: [3, 88], r: 5, density: 0.6 },
    { t: 'forest', circle: [50, 70], r: 5, density: 0.2 },
    // ore
    { t: 'ore', circle: [27, 89], r: 3.5 },
    { t: 'ore', circle: [7, 70], r: 3.2 },
    { t: 'ore', circle: [38, 70], r: 3.8 },
    { t: 'ore', circle: [22, 54], r: 3 },
    { t: 'gems', circle: [41, 53], r: 2.1 },
  ],
  bridges: [{ at: [19.5, 43.5], axis: 'y' }],
};

const archipelago: MapDef = {
  id: 'archipelago', name: 'Archipelago', size: 96, players: 2, climate: 'temperate', symmetry: 'rot2', seed: 3301, ground: 'water',
  desc: 'Two home islands in open sea. A chain of islets, sandbars and a bridge leads to the gem island; the sea decides the rest.',
  tags: ['Naval', 'Islands', 'Bridges', '1v1'], naval: true,
  starts: [[14.5, 80.5]],
  features: [
    { t: 'clear', ellipse: [24, 75], rx: 16.5, ry: 13.5, angle: -12, wobble: 2.2 },
    { t: 'clear', circle: [46, 66], r: 4.8, wobble: 1.4 },
    { t: 'clear', circle: [30, 49], r: 4.6, wobble: 1.4 },
    { t: 'clear', circle: [48, 48], r: 6.2, wobble: 1.6 },
    { t: 'clear', circle: [8, 44], r: 3.4, wobble: 1.2 },
    { t: 'ford', path: [[37.5, 70], [42.5, 67]], w: 2.6, wobble: 0.3 },
    { t: 'ford', path: [[47.5, 61.5], [48, 53.5]], w: 2.6, wobble: 0.3 },
    { t: 'rock', circle: [36, 78], r: 2 },
    { t: 'forest', ellipse: [12, 66], rx: 6, ry: 3.5, angle: -30, density: 0.75 },
    { t: 'forest', circle: [34, 86], r: 3.5, density: 0.6 },
    { t: 'forest', circle: [30, 48], r: 3, density: 0.35 },
    { t: 'ore', circle: [27, 86], r: 3.7 },
    { t: 'ore', circle: [23, 66], r: 3.5 },
    { t: 'ore', circle: [47, 67], r: 3.1 },
    { t: 'ore', circle: [30, 50], r: 2.9, rich: 1.3 },
    { t: 'gems', circle: [48, 48], r: 3.4 },
  ],
  bridges: [{ at: [29.5, 57.5], axis: 'y' }],
  clearRadius: 9,
};

const inlandSea: MapDef = {
  id: 'inland-sea', name: 'Inland Sea', size: 128, players: 4, climate: 'temperate', symmetry: 'rot4', seed: 4409,
  desc: 'Four commanders ring a great inland sea. Every base has a harbour bay; bridged causeways lead to the gem isle at its heart.',
  tags: ['Naval', 'Bridges', '4 players', 'FFA'], naval: true,
  starts: [[18.5, 109.5]],
  features: [
    { t: 'water', circle: [64, 64], r: 26, wobble: 2.6, freq: 0.15 },
    { t: 'water', path: [[54, 80], [40, 89], [29, 100]], w: 9, wobble: 1.6 },
    { t: 'clear', circle: [64, 64], r: 5.5, wobble: 1 },
    { t: 'ford', path: [[37, 66], [45.5, 65.4]], w: 2.6, wobble: 0.3 },
    { t: 'ford', path: [[51.5, 65], [59, 64.5]], w: 2.6, wobble: 0.3 },
    { t: 'rock', path: [[8, 70], [16, 64], [20, 56]], w: 2.8 },
    { t: 'rock', circle: [44, 118], r: 2.4 },
    { t: 'forest', circle: [6, 84], r: 6, density: 0.8 },
    { t: 'forest', ellipse: [30, 76], rx: 6, ry: 3.5, angle: 50, density: 0.6 },
    { t: 'forest', circle: [52, 124], r: 5, density: 0.7 },
    { t: 'forest', circle: [40, 106], r: 4, density: 0.25 },
    { t: 'ore', circle: [31, 117], r: 3.6 },
    { t: 'ore', circle: [10, 95], r: 3.4 },
    { t: 'ore', circle: [14, 76], r: 3.4 },
    { t: 'ore', circle: [46, 96], r: 3 },
    { t: 'gems', circle: [64, 64], r: 3 },
  ],
  bridges: [{ at: [48.5, 65.5], axis: 'x' }],
  clearRadius: 8.5,
};

const threeKingdoms: MapDef = {
  id: 'three-kingdoms', name: 'Three Kingdoms', size: 112, players: 3, climate: 'temperate', symmetry: 'rot3', center: [56, 58], seed: 5503,
  desc: 'Three realms separated by broken ridges meet at a gem crater. Every pass is a choke point; every neighbour a threat.',
  tags: ['3 players', 'FFA', 'Ridges'],
  starts: [[56.5, 95.5]],
  features: [
    { t: 'water', circle: [44, 81], r: 3.6 },
    { t: 'rock', path: [[67, 64.5], [74, 68.5]], w: 3 },
    { t: 'rock', path: [[79.5, 71.5], [88, 76.5]], w: 3 },
    { t: 'rock', circle: [56, 58], r: 6.5, wobble: 0.8 },
    { t: 'clear', path: [[56, 72], [56, 58]], w: 3.4, wobble: 0.4 },
    { t: 'forest', circle: [37, 101], r: 6.5, density: 0.78 },
    { t: 'forest', circle: [76, 106], r: 5.5, density: 0.75 },
    { t: 'forest', circle: [66, 82], r: 3.5, density: 0.3 },
    { t: 'ore', circle: [44, 103], r: 3.4 },
    { t: 'ore', circle: [69, 102], r: 3.3 },
    { t: 'ore', circle: [56, 77], r: 3.6 },
    { t: 'ore', circle: [84, 86], r: 3 },
    { t: 'gems', circle: [56, 60], r: 2.4 },
    // dead corners outside the triangle (no ore; looks only)
    { t: 'forest', ellipse: [56, 6], rx: 34, ry: 7, density: 0.6, once: true },
    { t: 'rock', circle: [4, 104], r: 7, once: true },
    { t: 'rock', circle: [108, 104], r: 7, once: true },
  ],
};

const coastline: MapDef = {
  id: 'coastline', name: 'Coastline', size: 128, players: 4, climate: 'temperate', symmetry: 'mirror4', seed: 6607,
  desc: 'A peninsula wrapped in sea, quartered by rivers that drain into a central lagoon. Bridges and fords link the four corners.',
  tags: ['Naval', 'Bridges', '4 players', 'FFA'], naval: true,
  starts: [[19.5, 108.5]],
  features: [
    { t: 'water', rect: [-6, 120, 70, 134], wobble: 2.4, freq: 0.12 },
    { t: 'water', rect: [-6, -6, 8, 70], wobble: 2.4, freq: 0.12 },
    { t: 'water', circle: [6, 122], r: 9 },
    { t: 'water', path: [[64, 130], [63, 100], [65, 82], [64, 70]], w: 4, wobble: 0.7 },
    { t: 'water', path: [[-2, 64], [30, 65], [46, 63], [58, 64]], w: 4, wobble: 0.7 },
    { t: 'water', circle: [64, 64], r: 9, wobble: 1 },
    { t: 'ford', path: [[59, 84.5], [69, 84.5]], w: 2.8, wobble: 0.2 },
    { t: 'ford', path: [[44, 59], [44, 69]], w: 2.8, wobble: 0.2 },
    { t: 'rock', circle: [40, 100], r: 2.6 },
    { t: 'rock', path: [[30, 80], [36, 76]], w: 2.4 },
    { t: 'forest', circle: [16, 84], r: 6.5, density: 0.78 },
    { t: 'forest', circle: [44, 114], r: 5, density: 0.7 },
    { t: 'forest', path: [[50, 92], [56, 104]], w: 4, density: 0.5 },
    { t: 'ore', circle: [32, 115], r: 3.8 },
    { t: 'ore', circle: [13, 95], r: 3.5 },
    { t: 'ore', circle: [40, 89], r: 4 },
    { t: 'gems', circle: [53, 75], r: 2.3 },
  ],
  bridges: [{ at: [64.5, 100.5], axis: 'x' }, { at: [26.5, 64.5], axis: 'y' }],
  clearRadius: 8.5,
};

const frozenLakes: MapDef = {
  id: 'frozen-lakes', name: 'Frozen Lakes', size: 96, players: 2, climate: 'winter', symmetry: 'rot2', seed: 7717,
  desc: 'Pine forests and frozen lakes funnel armies into three snowbound corridors. The middle one passes the gem field.',
  tags: ['Winter', 'Lakes', '1v1'],
  starts: [[15.5, 80.5]],
  features: [
    { t: 'water', ellipse: [36, 46], rx: 9, ry: 5, angle: -40, wobble: 1.6 },
    { t: 'water', ellipse: [18, 30], rx: 7, ry: 4.5, angle: 20, wobble: 1.6 },
    { t: 'water', ellipse: [52, 78], rx: 8, ry: 4, angle: -10, wobble: 1.6 },
    { t: 'water', circle: [62, 56], r: 4.2, wobble: 1.2 },
    { t: 'water', circle: [6, 54], r: 3.4 },
    { t: 'forest', ellipse: [26, 62], rx: 7, ry: 4, angle: -45, density: 0.8 },
    { t: 'forest', circle: [40, 90], r: 6, density: 0.8 },
    { t: 'forest', circle: [70, 88], r: 6.5, density: 0.8 },
    { t: 'forest', circle: [4, 40], r: 5, density: 0.7 },
    { t: 'forest', circle: [48, 34], r: 3.5, density: 0.55 },
    { t: 'forest', circle: [30, 76], r: 4, density: 0.2 },
    { t: 'rock', circle: [44, 62], r: 2.2 },
    { t: 'ore', circle: [27, 88], r: 3.4 },
    { t: 'ore', circle: [8, 68], r: 3.4 },
    { t: 'ore', circle: [34, 66], r: 3.6 },
    { t: 'ore', circle: [22, 44], r: 3 },
    { t: 'gems', circle: [48, 48], r: 2.6 },
  ],
};

const redCanyon: MapDef = {
  id: 'red-canyon', name: 'Red Canyon', size: 96, players: 2, climate: 'desert', symmetry: 'rot2', seed: 8803, relief: 1.6,
  desc: 'Towering mesas carve the desert into three lanes: a wide central wash and two narrow canyons rich with ore.',
  tags: ['Desert', 'Canyons', '1v1'],
  starts: [[14.5, 81.5]],
  features: [
    { t: 'rock', ellipse: [33, 33], rx: 22, ry: 11, angle: -45, wobble: 2, freq: 0.16 },
    { t: 'rock', ellipse: [14, 14], rx: 9, ry: 8, wobble: 1.8 },
    { t: 'sand', path: [[22, 52], [32, 40], [44, 26]], w: 4, wobble: 0.8 },
    { t: 'rock', circle: [40, 56], r: 2 },
    { t: 'rock', circle: [52, 44], r: 1.6 },
    { t: 'sand', path: [[14, 81], [48, 48]], w: 7, wobble: 2 },
    { t: 'water', circle: [6, 92], r: 2.4 },
    { t: 'forest', circle: [6, 92], r: 5, density: 0.45 },
    { t: 'forest', circle: [26, 66], r: 3, density: 0.25 },
    { t: 'ore', circle: [27, 89], r: 3.5 },
    { t: 'ore', circle: [7, 68], r: 3.3 },
    { t: 'ore', circle: [33, 37], r: 2.6, rich: 1.2 },
    { t: 'ore', circle: [8, 36], r: 3.2 },
    { t: 'gems', circle: [48, 48], r: 2.6 },
  ],
};

const pocketValley: MapDef = {
  id: 'pocket-valley', name: 'Pocket Valley', size: 64, players: 2, climate: 'temperate', symmetry: 'rot2', seed: 9901,
  desc: 'A small, fast map: a rocky ridge with three passes separates the bases. Rush or tech — the first push decides.',
  tags: ['Small', 'Rush', '1v1'],
  starts: [[10.5, 53.5]],
  features: [
    { t: 'rock', path: [[-2, 30], [13, 33], [26, 32]], w: 3, wobble: 0.8 },
    { t: 'clear', path: [[12, 27], [12, 38]], w: 3.2, wobble: 0.3 },
    { t: 'forest', path: [[22, 29], [28, 30]], w: 3, density: 0.7 },
    { t: 'water', circle: [40, 48], r: 3.4 },
    { t: 'forest', circle: [3, 40], r: 4, density: 0.6 },
    { t: 'forest', circle: [45, 61], r: 4, density: 0.7 },
    { t: 'ore', circle: [21, 59], r: 3.8 },
    { t: 'ore', circle: [4, 44], r: 3.3 },
    { t: 'ore', circle: [26, 43], r: 3.6 },
    { t: 'ore', circle: [33, 60], r: 2.8 },
    { t: 'gems', circle: [32, 32], r: 2.2 },
  ],
  clearRadius: 8.5,
};

export const MAP_DEFS: MapDef[] = [provingGrounds, bridgewater, archipelago, frozenLakes, redCanyon, pocketValley, threeKingdoms, inlandSea, coastline];
