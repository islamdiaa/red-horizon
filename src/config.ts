/**
 * Display name. "Red Alert" and "Command & Conquer" are EA trademarks that the GPL
 * source release explicitly does not license, so this remake uses its own name.
 */
export const GAME_TITLE = 'RED HORIZON';
export const GAME_SUBTITLE = 'A Cold War Real-Time Strategy';
export const VERSION = '0.1.0';

/**
 * Online play: the multiplayer lobby, invite links (#join=) and the global leaderboards, all served by the relay
 * (server/). A build with `VITE_MULTIPLAYER=off` is for a static host without one: no menu entries, no invite
 * links, no relay requests, and that code is never loaded. vite.config.ts replaces `globalThis.__RH_MULTIPLAYER__`
 * with a literal at build time; node tests may set it on globalThis.
 */
export const MULTIPLAYER: boolean = (globalThis as { __RH_MULTIPLAYER__?: boolean }).__RH_MULTIPLAYER__ ?? true;
/** Game speed steps (HUD buttons and the [ / ] keys). Speed only changes how many fixed 20 Hz ticks run per
 *  frame, so saves and replays are unaffected. */
export const GAME_SPEEDS = [1, 2, 3, 5] as const;
export const GAME_SPEED_LABELS = ['Normal', 'Fast', 'Faster', 'Maximum'] as const;

/** Player colours, in slot order (the local player is slot 0). */
export const TEAM_COLORS = [0x3d7be0, 0xd23a2c, 0xe0b030, 0x3fa34d, 0xe07b2a, 0x8e4fd0, 0x2aa8a8, 0x9aa0aa];
