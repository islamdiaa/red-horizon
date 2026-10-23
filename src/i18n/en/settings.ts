/**
 * The Settings screen (src/ui/menu.ts showSettings) and its offline-content row (src/ui/offline-setting.ts).
 * The Accessibility section lives in ./a11y.ts.
 */
import { strings } from '../core';

export default strings('settings', {
  kicker: 'Options',
  graphics: 'Graphics',
  audio: 'Audio',
  gameplay: 'Gameplay',
  quality: 'Quality',
  qualitySub: 'Applies to the next battle',
  qualityLow: 'Low',
  qualityMedium: 'Medium',
  qualityHigh: 'High',
  modelDetail: 'Model detail',
  modelDetailSub: 'HD: baked high-detail buildings and vehicles (more memory) · Standard: lighter models',
  // model detail options
  modelHd: 'HD',
  modelStandard: 'Standard',
  perfOverlay: 'Performance overlay',
  perfOverlaySub: 'FPS and renderer stats in the top bar',
  reduceMotion: 'Reduce motion',
  reduceMotionSub: 'Calmer UI animations',
  renderScale: 'Render resolution',
  renderScaleSub: 'Auto: lowers the 3D view\'s resolution when the frame rate drops (the interface stays sharp)',
  // render resolution option
  renderScaleAuto: 'Auto',
  layout: 'Interface layout',
  layoutSub: 'Modern: build bar at the bottom, panels in the corners · Classic: the sidebar on the right',
  // interface layout options
  layoutModern: 'Modern',
  layoutClassic: 'Classic',
  // added to the layout setting's description when the window is too narrow, short or tall for the Classic sidebar
  layoutNarrow: 'Classic needs a wider window: this one shows Modern until it is wide enough',
  // volume sliders
  volume: {
    master: 'Master',
    sfx: 'Effects',
    music: 'Music',
    voice: 'Voices',
    ambience: 'Ambience',
  },
  language: 'Language',
  languageSub: 'Menus, battle interface and captions · Auto follows the browser',
  // the automatic choice, with the language it picked: "Auto (Deutsch)"
  languageAuto: 'Auto ({lang})',
  languageInBattle: 'Change the language from the main menu',
  edgeScroll: 'Edge scrolling',
  edgeScrollSub: 'Scroll when the cursor touches the screen edge',
  unitVoices: 'Unit voices',
  unitVoicesSub: 'Acknowledgements when giving orders',
  hints: 'Field manual hints',
  hintsSub: 'Contextual tips for new commanders',
  skipIntro: 'Skip intro cinematic',
  skipIntroSub: 'Start every battle at your base',
  fullscreen: 'Fullscreen in battle',
  fullscreenSub: 'Hides the browser so the map scrolls at the screen edge (Alt+Enter toggles)',
  offline: {
    title: 'HD content for offline play',
    sub: 'Every HD model and terrain texture, kept on this device for playing offline',
    subLazy: 'Data Saver or a mobile connection: HD content otherwise loads only when a battle needs it',
    again: 'Download again',
    unsupported: 'Offline play needs the installed app: open the game once from its web address, then reload',
    local: 'The desktop app keeps everything on this device already',
    progress: 'Downloading {done} / {total} files…',
    progressSize: 'Downloading {done} / {total} files · {size}…',
    done: 'Ready for offline play ({size})',
    partial: '{n, plural, one {# file} other {# files}} could not be downloaded: try again with a connection',
    estimate: 'about {size}',
    // a download size in megabytes
    mb: '{n} MB',
  },
});
