/**
 * Cinematic overlays (src/cinematic.ts): the opening briefing typed over the battlefield, the incoming-nuke
 * warning and the VICTORY / DEFEAT finale. Texts are shown in capitals, as written here.
 */
import { liveStrings, strings } from '../core';

/** Skirmish operation code names and front sectors, picked by the match seed (translated on read). */
export const CINE_NAMES = liveStrings('cinematic.names', {
  // operation code names, shown as OPERATION <NAME>
  operations: ['IRON DAWN', 'RED TEMPEST', 'NORTHERN WRATH', 'STEEL CURTAIN', 'SILENT THUNDER', 'BROKEN ARROW', 'CRIMSON TIDE', 'GLASS HAMMER', 'WINTER SUN', 'LONG SHADOW'],
  // places of the Cold War front (shown in capitals)
  sectors: ['Carpathian Front', 'Baltic Coast', 'Danube Valley', 'Bavarian Highlands', 'Vistula Basin', 'Black Forest', 'Thuringian Gap', 'Silesian Plains', 'Alpine Pass', 'Pomeranian Lakes'],
});

export default strings('cinematic', {
  intro: {
    // the operation's code name is in bold
    operation: 'OPERATION [b]{name}[/b]',
    allies: 'Allied Expeditionary Force',
    soviet: 'Red Army Group "Vostok"',
    // second briefing line: {clock} is the local time (14:05)
    status: 'DAY 1  ·  {clock} LOCAL  ·  {n, plural, one {# HOSTILE FORCE DETECTED} other {# HOSTILE FORCES DETECTED}}',
    skip: 'PRESS ANY KEY TO SKIP',
    // on touch screens
    skipTouch: 'TAP TO SKIP',
  },
  nuke: {
    warning: 'WARNING',
    detected: 'NUCLEAR LAUNCH DETECTED',
    // {s}: seconds to impact (e.g. 12.5)
    impact: 'IMPACT IN {s}s — EVACUATE THE MARKED ZONE',
  },
  end: {
    victory: 'VICTORY',
    defeat: 'DEFEAT',
  },
});
