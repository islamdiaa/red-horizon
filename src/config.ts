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

/** Player colours, in slot order (the local player is slot 0). */
export const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];
