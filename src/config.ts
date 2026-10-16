/**
 * Display name. "Red Alert" and "Command & Conquer" are EA trademarks that the GPL
 * source release explicitly does not license, so this remake uses its own name.
 */
export const GAME_TITLE = 'RED HORIZON';
export const GAME_SUBTITLE = 'A Cold War Real-Time Strategy';
export const VERSION = '0.1.0';
/** Game speed steps (HUD buttons and the [ / ] keys). Speed only changes how many fixed 20 Hz ticks run per
 *  frame, so saves and replays are unaffected. */
export const GAME_SPEEDS = [1, 2, 3, 5] as const;
export const GAME_SPEED_LABELS = ['Normal', 'Fast', 'Faster', 'Maximum'] as const;
