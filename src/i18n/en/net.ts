/**
 * Multiplayer and leaderboard texts: the in-match network UI (src/net/game-link.ts), the leaderboard submit card
 * (src/net/leaderboard.ts), connection end reasons, and the English the relay and the leaderboard server send
 * (src/net/reasons.ts, matched with trSource() where it is shown).
 */
import { sourceStrings, strings } from '../core';
import { RELAY_ERRORS, START_PROBLEMS, SUBMISSION_ERRORS, VERIFY_REASONS } from '../../net/reasons';

/** Why a room cannot start (net.start.<id>; the lobby reads them with tx(), the relay's copy is matched). */
export const START_TEXT = sourceStrings('net.start', START_PROBLEMS);
/** Relay error messages. */
export const RELAY_TEXT = sourceStrings('net.relay', RELAY_ERRORS);
/** Leaderboard verification rejections. */
export const VERIFY_TEXT = sourceStrings('net.verify', VERIFY_REASONS);
/** Leaderboard submission / route errors. */
export const SUBMISSION_TEXT = sourceStrings('net.submit', SUBMISSION_ERRORS);
/** Why a mission run ended after a surrender (src/sim/resign.ts SURRENDERED: the simulation's English). */
export const RESIGN_TEXT = sourceStrings('net.resign', { surrendered: 'Surrendered' });

export default strings('net', {
  chip: {
    // latency chip in a match: the numbers are in bold
    latency: '[b]{ms}[/b] ms · delay [b]{delay}[/b] ms',
    offline: 'offline',
    chat: 'Chat',
    mute: 'Mute chat',
    unmute: 'Unmute chat',
  },
  banner: {
    lostKicker: 'Connection lost',
    reconnecting: 'Reconnecting to the match…',
    goneKicker: 'Disconnected',
    gone: 'The connection to the match ended.',
    // {reason}: why it ended (see reason.*)
    goneReason: 'The connection to the match ended ({reason}).',
    leave: 'Leave',
    // the relay is gone for good (restarted, shut down, or the reconnect gave up): the battle can go on on this computer
    offlineOffer: 'You can finish the battle on this computer: the AI takes over the other players.',
    playOffline: 'Play on vs AI',
    rejoinKicker: 'Rejoining',
    catchingUp: 'Catching up with the match… {pct}%',
    pausedKicker: 'Match paused · {s} s',
    stallLoading: 'Waiting for [b]{name}[/b], who is still loading.',
    stallGone: 'Waiting for [b]{name}[/b], who lost the connection.',
    stallSlow: 'Waiting for [b]{name}[/b], who is not responding.',
    drop: 'Drop · AI takes over',
  },
  chat: {
    placeholder: 'Message to everyone · Enter to send',
    left: '{name} left the match. The AI takes over.',
    watching: 'You are watching: the AI commands your forces.',
    // surrender (src/sim/resign.ts): a player whose side conceded, or whose team fights on with the AI
    surrendered: '{name} surrendered.',
    surrenderedAi: '{name} surrendered. The AI takes over their forces.',
    youSurrendered: 'You surrendered.',
    // chat typed while reconnecting (src/net/client.ts keeps up to four lines)
    queued: 'Not sent yet: reconnecting. It goes out when the connection is back.',
    dropped: 'Not sent: the connection is down.',
    // after "Play on vs AI" (banner.playOffline)
    offline: 'Playing on offline: the AI commands the other players. This battle continues on this computer only.',
  },
  // the in-match menu's Surrender entry and its confirmation (src/net/surrender.ts)
  surrender: {
    button: 'Surrender',
    kicker: 'Surrender',
    title: 'Surrender the battle?',
    // 1v1, free for all, skirmish: the side concedes
    bodyConcede: 'Your forces are destroyed and the battle counts as a defeat.',
    // a team game where a human team-mate still plays
    bodyTeam: 'Your team fights on: the AI takes over your forces. The battle counts as a defeat for you.',
    // a ranked run (Survival, the Daily Challenge)
    bodyRun: 'The run ends here as a defeat. Your score so far counts.',
    confirm: 'Surrender',
    cancel: 'Keep fighting',
  },
  player: {
    // a player whose name is not known
    someone: 'A player',
    seat: 'Seat {n}',
    you: '{name} (you)',
  },
  desync: {
    kicker: 'Match stopped',
    title: 'Desync detected',
    body: 'The players\' simulations no longer agree, so the match cannot go on. This is a bug (or a modified game): saving the replay helps find it.',
    first: 'First difference',
    // simulation tick number (shown as code)
    tick: 'tick {tick}',
    yourHash: 'Your hash at that tick',
    unknown: 'not known',
    save: 'Save replay',
    download: 'Download replay',
    leave: 'Leave match',
    saved: 'Saved to Replays',
    saveFailed: 'Could not save',
  },
  // Why a connection ended, shown in brackets after "Disconnected" (the relay and the client send these words)
  reason: {
    kicked: 'kicked',
    empty: 'empty',
    idle: 'idle',
    over: 'over',
    shutdown: 'server shutting down',
    desync: 'desync',
    everyoneLeft: 'everyone left',
    timeLimit: 'time limit',
    finished: 'finished',
    lost: 'connection lost',
    closed: 'closed',
    // the relay no longer knows the match (it restarted)
    noRoom: 'the server no longer has this match',
  },
  board: {
    daily: 'Daily Challenge',
    survival: 'Survival · {front}',
    // a co-op survival board: {level} is the allies' AI difficulty (easy, normal, hard, brutal)
    coop: 'Survival · {front} · co-op ({n, plural, one {# {level, select, easy {easy} normal {normal} hard {hard} brutal {brutal} other {{level}}} ally} other {# {level, select, easy {easy} normal {normal} hard {hard} brutal {brutal} other {{level}}} allies}})',
  },
  submit: {
    kicker: 'Global leaderboard · {board}',
    score: 'Score {score}',
    ask: 'Submit this run? The server replays it to verify the score. Your callsign is shown on the board.',
    submit: 'Submit',
    notNow: 'Not now',
    verifying: 'Verifying the run on the server…',
    ranked: 'Verified. Rank #{rank} today.',
    unranked: 'Verified, but not in today\'s top.',
    unavailable: 'The leaderboard server is not available ({status}).',
    unreachable: 'The leaderboard server could not be reached.',
    cannot: 'This run cannot be submitted.',
  },
});
