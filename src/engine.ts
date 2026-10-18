/**
 * The engine side of the app: everything a match (or the menu's backdrop battle) needs that the menu's first
 * frame does not. three.js, the renderer, the models, the HUD and the match screens load through this module
 * with one dynamic import (main.ts starts it at boot, so it downloads while the menu is already up).
 */
export { Game } from './game';
export { AIController } from './sim/ai';
export { chargeArmies, debugConstruct } from './debug';
export { hdModelsEnabled, hdStatus, prefetchHdFiles, setHdModels } from './render/models/hd';
export { preloadHd } from './render/models';
export { attachModes, modesOnEnd, offerMoments, setModeHost } from './modes/ui'; // KOTH, challenges, branches, co-op
export { attachVariety } from './ui/variety-hud';
export { createAttractGame } from './share/attract'; // directed menu backdrop
