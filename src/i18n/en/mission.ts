/**
 * The mission HUD (src/ui/missionhud.ts): objectives checklist, radio transmissions, countdown and score. The
 * objective texts, radio lines, speakers and timer / score labels are the mission scripts' English, translated
 * where they are shown (trSource).
 */
import { strings } from '../core';

export default strings('mission', {
  // checklist headings (shown in capitals)
  objectives: 'OBJECTIVES',
  optional: 'OPTIONAL',
  // a radio transmission read out to screen readers
  radioSr: '{speaker}: {text}',
});
