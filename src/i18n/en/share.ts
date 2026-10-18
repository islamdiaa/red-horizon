/**
 * Sharing: share links (src/share/dialog.ts, open.ts, content.ts, codec.ts), highlight clips (src/ui/clips.ts),
 * video recording (src/share/recorder.ts) and the trailer (src/share/trailer.ts). URLs, codes and file names
 * are not translated; the text a player posts with a link is.
 */
import { strings } from '../core';

export default strings('share', {
  // what is shared: kind is map, challenge or replay
  kind: {
    map: 'Map',
    challenge: 'Challenge',
    replay: 'Replay',
  },
  modal: {
    closeTip: 'Close (Esc)',
  },
  dialog: {
    kicker: '{kind, select, map {Share map} challenge {Share challenge} other {Share replay}}',
    preparing: 'Preparing the link…',
    unsupported: 'This browser cannot build share links.',
    noAddress: 'This copy of the game has no public web address to link to.',
    // {chars} and {max} are character counts
    tooLong: 'Too long for a link ({chars} characters; links hold up to {max}).',
    chat: 'Short enough for Discord, WhatsApp, X and email.',
    browser: 'Works in WhatsApp, email and browsers; too long for a Discord message.',
    fallback: 'Download the file instead and send it as an attachment: it opens with Import.',
    linkLabel: 'Share link',
    // the link length under the link: "1,234 chars"
    chars: '[b]{n}[/b] chars',
    copyLink: 'Copy link',
    shareSheet: 'Share…',
    downloadFile: 'Download file',
    privacy: 'Everything is inside the link, after the [b]#[/b]: browsers never send that part to any server, and nothing is uploaded. Whoever opens it is asked before anything is imported.',
    copied: 'Link copied to the clipboard.',
    copyBlocked: 'Copy blocked by the browser: the link is selected, press Ctrl+C.',
    downloaded: 'File downloaded.',
    // the message sent with the link through the system share sheet
    shareText: '{kind, select, map {Map for Red Horizon: {title}} challenge {Challenge for Red Horizon: {title}} other {Replay for Red Horizon: {title}}}',
  },
  open: {
    kicker: 'Share link',
    cannotOpen: 'Cannot open this link',
    unreadable: 'The share link could not be read.',
    nothingImported: 'Nothing was imported. If a friend sent it, ask them for the file instead (Export in the same screen).',
    sharedKicker: '{kind, select, map {Shared map} challenge {Shared challenge} other {Shared replay}}',
    introMapMission: 'Someone shared a map with you. Play it now (its mission), or add it to your custom maps (the Skirmish map list and the Map Editor).',
    introMapSkirmish: 'Someone shared a map with you. Play it now (a skirmish against the AI), or add it to your custom maps (the Skirmish map list and the Map Editor).',
    introChallenge: 'Someone shared a challenge with you. Play it now, or add it to Challenges › Scenario challenges.',
    introReplay: 'Someone shared a replay with you. Watch it now, or add it to your Replays.',
    watch: 'Watch',
    import: 'Import',
    privacy: 'Shared content only describes game data (terrain, units, orders). It was checked like an imported file and cannot run code or reach your other data.',
    importedMap: 'Imported: pick it under Skirmish › Map, or open it in the Map Editor.',
    importedChallenge: 'Imported: find it under Challenges › Scenario challenges.',
    importedReplay: 'Imported: find it under Replays.',
    saveFailed: 'Could not save it (storage full or blocked).',
    startFailed: 'Could not start it.',
  },
  // short facts about a shared item, shown as chips
  facts: {
    players: '{n, plural, one {# player} other {# players}}',
    temperate: 'Temperate',
    winter: 'Winter',
    desert: 'Desert',
    withMission: 'with a mission',
    minutes: '{n} min',
    // replay players: "Ivan vs Anna"
    vs: '{a} vs {b}',
    skirmish: 'Skirmish',
    goalWin: 'Win',
    goalSurvive: 'Survive',
    goalDestroy: 'Destroy',
    goalProtect: 'Protect',
    // the challenge goal "hold a position"
    goalHold: 'Hold',
    goalOther: 'Challenge',
  },
  untitled: {
    map: 'Shared map',
    challenge: 'Shared challenge',
    replay: 'Shared replay',
  },
  invalid: {
    // {errors}: the map checker's messages
    map: 'The shared map is not valid: {errors}',
    challenge: 'The shared challenge is not valid: {error}.',
    unknownFormat: 'unknown format',
    challengeSetup: 'The shared challenge cannot be played: {problem}.',
    replay: 'The shared replay is not valid, or from an unsupported version.',
    replayLong: 'The shared replay is longer than a link can hold.',
    replayData: 'The shared replay holds more data than the game accepts.',
    replaySetup: 'The shared replay cannot be played: {problem}.',
  },
  // why a shared challenge or replay cannot be played (after "cannot be played: ")
  setup: {
    none: 'it has no match setup',
    mapSize: 'its map size is out of range',
    players: 'it has too many players',
    allies: 'it has too many allies',
    mutators: 'it has too many mutators',
    credits: 'its credits are out of range',
    map: 'its map is not valid',
    mods: 'its mods are not valid',
  },
  link: {
    damaged: 'The share link is damaged.',
    cannotCreate: 'This browser cannot create share links.',
    empty: 'The share link is empty.',
    tooLong: 'The share link is too long.',
    newer: 'This share link needs a newer version of the game.',
    cannotOpen: 'This browser cannot open share links.',
    tooMuch: 'The share link holds more data than the game accepts.',
    notOurs: 'Not a Red Horizon share link.',
    unknownKind: 'This share link holds something this version of the game cannot open.',
  },
  record: {
    unsupported: 'This browser cannot record video.',
    noCanvas: 'No 2D canvas for recording.',
    failed: 'Recording failed.',
  },
  clip: {
    kicker: 'Highlight clip',
    // the caption over the first seconds of a clip
    cardKicker: 'Red Horizon · highlight',
    free: 'Free in your browser',
    // the default clip label in the replay viewer
    mapHighlight: '{map} highlight',
    noRecorder: 'This browser cannot record video (MediaRecorder is missing).',
    cannotRecord: 'Cannot record',
    empty: 'The browser produced an empty recording.',
    // recording indicator (shown in capitals)
    rec: 'REC',
    info: '{w}×{h} · {format} · {mb} MB. Recorded on this device; nothing was uploaded.',
    again: 'Record again',
    savedAs: 'Saved as {name}',
    buttonTip: 'Record a {s} s highlight clip from here (WebM video with sound)',
    button: 'Record clip',
  },
  trailer: {
    gateTitle: 'Red Horizon trailer',
    gateVideo: 'An 85-second cut of a staged battle with title cards. Record it to a WebM video (with sound) for social media; it plays in real time at your graphics quality.',
    gateNoVideo: 'An 85-second cut of a staged battle with title cards. Record it to a video (not supported in this browser); it plays in real time at your graphics quality.',
    record: 'Record trailer',
    justPlay: 'Just play',
    recTime: 'REC {s} / {total} s',
    endTitle: 'That was Red Horizon',
    endText: 'Play it free in your browser.',
    again: 'Watch again',
    // the result dialog's title for the recorded trailer
    label: 'Trailer',
    // title cards of the trailer (shown in capitals over the video)
    tagline: 'A Cold War real-time strategy',
    freeSite: 'Free in your browser · {site}',
    freeNoInstall: 'Free in your browser · no install',
    cards: {
      establishKicker: 'Real-time strategy',
      establish: 'Two superpowers',
      establishSub: 'Allies against Soviets',
      buildKicker: 'Build',
      build: 'Your war machine',
      buildSub: 'Bases · ore · power',
      teslaKicker: 'Defend',
      tesla: 'Tesla coils',
      clashKicker: 'Command',
      clash: 'Armoured warfare',
      navalKicker: 'Rule the waves',
      naval: 'Naval combat',
      alliedKicker: 'Allies',
      allied: 'Precision and technology',
      nukeKicker: 'Superweapons',
      nuke: 'Nuclear strike',
      endKicker: 'Campaigns · skirmish · replays',
      end: 'Every battle is yours',
    },
  },
});
