/**
 * English texts the relay and the leaderboard server send to players (and the lobby rules shared with the
 * relay). They travel as English over the wire, whatever the language: the client translates them where it
 * shows them (src/i18n/en/net.ts registers these tables, the display sites call trSource()).
 *
 * Dependency-free on purpose: the relay and the verification worker (server/) import it, and must not pull in
 * the interface translations.
 */

/** Why a room cannot start yet (src/net/settings.ts startProblem; the relay sends it with a 'not-ready' error). */
export const START_PROBLEMS = {
  needPlayer: 'Waiting for another player',
  reconnecting: 'A player is reconnecting',
  notReady: 'Waiting for everyone to be ready',
  needAi: 'Add at least one AI opponent',
  needTeams: 'Both teams need a player',
  fill2v2: 'Fill all four seats (players or AI)',
  ffaThree: 'Free for all needs at least three commanders',
  mapPlayers: '{name} is a {n}-player map',
} as const;

export type StartProblem = keyof typeof START_PROBLEMS;

/**
 * Error messages of the relay (server/src/relay.ts sends them as `{ t: 'error', msg }`, and ends matches with
 * some of them). Kept here so the client can recognise and translate them.
 */
export const RELAY_ERRORS = {
  busy: 'The server is full. Try again later.',
  malformed: 'Malformed message.',
  version: 'This game version does not match the server. Reload the page to update.',
  slowDown: 'Too many attempts. Wait a minute and try again.',
  noRoom: 'No room with that code. Check the code or ask for a new invite.',
  kicked: 'You were removed from this room.',
  inProgress: 'That match has already started.',
  build: 'Your game version differs from the host\'s. Both players need the same version (reload to update).',
  modsOn: 'This room plays with mods: enable the same mods to join.',
  modsOff: 'This room plays without mods: disable your mods to join.',
  full: 'The room is full.',
  mode: 'Too many players for that mode.',
  chatRate: 'You are sending messages too quickly.',
  tooEarly: 'You can drop a player after they have stalled the match for a while.',
  gone: 'That match is over or no longer exists.',
  buildRoom: 'Your game version differs from this room\'s.',
  logFull: 'The match log is full.',
} as const;

/** Why the leaderboard server rejected a run (src/net/verify.ts re-simulation; server/src/leaderboard). */
export const VERIFY_REASONS = {
  tooLong: 'The run is longer than this server verifies.',
  unknownBoard: 'Unknown leaderboard.',
  badCommand: 'The run contains an invalid command.',
  // (server/src/leaderboard/queue.ts tests for "too long")
  timeout: 'Verification took too long.',
  noEnd: 'The run does not end where it claims.',
  time: 'The run ends at a different time ({got} vs {claimed}).',
  hash: 'The final state does not match (different game version or a modified run).',
  score: 'The score does not match ({got} vs {claimed}).',
  result: 'The result does not match the run.',
  zero: 'Only runs that score are ranked.',
  // server/src/leaderboard/queue.ts and worker.ts
  busy: 'The leaderboard server is busy verifying other runs. Try again in a minute.',
  failed: 'The run could not be simulated.',
  noResult: 'No result.',
} as const;

/** Shape errors of a submitted run (src/net/boards.ts parseSubmission) and the leaderboard routes (server/src/http.ts). */
export const SUBMISSION_ERRORS = {
  notSubmission: 'Not a submission.',
  version: 'Unsupported submission version.',
  build: 'Bad build.',
  day: 'Bad day.',
  player: 'Bad player id.',
  length: 'Bad length.',
  hash: 'Bad hash.',
  score: 'Bad score.',
  result: 'Bad result.',
  tooMany: 'Too many commands.',
  cmds: 'Bad command list.',
  origin: 'Origin not allowed.',
  off: 'Leaderboards are off on this server.',
  reads: 'Too many requests.',
  bad: 'Bad request.',
  submits: 'Too many submissions. Try again later.',
  large: 'The run is too large.',
  serverBuild: 'Your game version differs from the leaderboard server\'s. Reload to update.',
  dailyClosed: 'That Daily Challenge is closed.',
  notFound: 'Not found.',
  server: 'Server error.',
} as const;

/** Fill `{name}` placeholders verbatim (no number formatting: these texts must not depend on a locale). */
export function fillEnglish(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}
