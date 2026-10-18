/**
 * The accessibility pass's strings (settings rows, key rebinding, subtitles, diagnostics), as tables that translate
 * on read (liveStrings): keys a11y.<table>.<name>. Used through src/ui/a11y-strings.ts.
 */
import { liveStrings } from '../core';

/** Settings screen: the Accessibility section and its rows. */
export const SETTINGS_TEXT = liveStrings('a11y.settings', {
  section: 'Accessibility',
  teamColours: 'Team colours',
  teamColoursSub: 'Units, minimap, health bars and selection rings · display only',
  palDefault: 'Default',
  palCvd: 'Colour-blind',
  palVs: 'You vs enemies',
  palDefaultTip: 'Each player keeps the colour picked in the setup',
  palCvdTip: 'Okabe–Ito colours, safe for protanopia, deuteranopia and tritanopia: you are always blue',
  palVsTip: 'You are blue, allies green, every enemy orange',
  uiScale: 'Interface size',
  uiScaleSub: 'Scales the HUD and the menus (80–150%)',
  subtitles: 'Subtitles',
  subtitlesSub: 'Captions for the announcer at the bottom of the screen (off: shown with the other notices)',
  subtitleSize: 'Subtitle size',
  subtitleSizeSub: 'Also sizes the radio transmissions',
  sizeSmall: 'S',
  sizeMedium: 'M',
  sizeLarge: 'L',
  sizeXl: 'XL',
  sizeSmallName: 'Small',
  sizeMediumName: 'Medium',
  sizeLargeName: 'Large',
  sizeXlName: 'Extra large',
  keys: 'Key bindings',
  keysSub: 'Rebind the battle hotkeys',
  keysButton: 'Customise',
  support: 'Support',
  diagnostics: 'Copy diagnostics',
  diagnosticsSub: 'A plain-text report for bug reports: versions, browser, GPU, settings and recent errors. No personal data, nothing is sent.',
  diagnosticsButton: 'Copy',
  copied: 'Copied ✓',
  copyFailed: 'Copy failed',
  copiedStatus: 'Diagnostics copied to the clipboard: paste them into your bug report.',
  copyFailedStatus: 'The clipboard is unavailable: the report was printed to the browser console (F12).',
} as const);

/** The key rebinding screen. */
export const CONTROLS_TEXT = liveStrings('a11y.controls', {
  kicker: 'Field manual',
  title: 'Key bindings',
  intro: 'Click a key to change it, then press the new key. Esc cancels. Each action can have two keys.',
  press: 'Press a key…',
  unbound: 'Add',
  clear: 'Remove this key',
  resetRow: 'Reset to default',
  resetAll: 'Reset all to defaults',
  resetDone: 'All keys reset to their defaults',
  saved: 'Saved',
  back: 'Back',
  conflictOne: '1 key is bound to more than one action: only the first action responds to it.',
  conflictMany: '{n} keys are bound to more than one action: only the first action responds to each.',
  conflictWith: 'Also bound to {action}',
  bound: '{key} is now bound to {action}',
  groupMods: 'Control groups',
  groupAssign: 'Assign a group',
  groupAdd: 'Add to a group',
  groupModsSub: 'Modifier + 1–9 · plain 1–9 recalls',
  groupModsSame: 'Assign and add need different modifiers',
  altWarning: 'Some browsers use Alt + number to switch tabs',
  fixedKeys: 'Fixed keys: Esc (menu) · 1–9 (control groups) · Tab and B (build bar) · Alt + Enter (fullscreen)',
  helpButton: 'Customise keys',
} as const);

/** Why a key can't be bound. */
export const KEY_TEXT = liveStrings('a11y.keyReserved', {
  reservedInvalid: 'That key cannot be used',
  reservedEsc: 'Esc opens the menu and cancels',
  reservedMenus: 'Reserved for menus and the build bar',
  reservedGroups: 'Number keys are the control groups',
  reservedBuild: 'B arms the build bar (Modern layout)',
  reservedBrowser: 'Reserved by the browser',
} as const);

export const GROUP_TEXT: Record<string, string> = liveStrings('a11y.keyGroup', {
  camera: 'Camera',
  orders: 'Orders',
  stances: 'Stances',
  selection: 'Selection',
  base: 'Base',
  game: 'Game',
});

export const ACTION_TEXT: Record<string, string> = liveStrings('a11y.action', {
  camUp: 'Scroll up',
  camDown: 'Scroll down',
  camLeft: 'Scroll left',
  camRight: 'Scroll right',
  rotateLeft: 'Rotate left',
  rotateRight: 'Rotate right',
  resetNorth: 'Face north',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  home: 'Jump to base',
  lastAttack: 'Jump to last attack',
  follow: 'Follow the selection',
  bookmark1: 'Camera bookmark 1 (Ctrl: save)',
  bookmark2: 'Camera bookmark 2 (Ctrl: save)',
  bookmark3: 'Camera bookmark 3 (Ctrl: save)',
  bookmark4: 'Camera bookmark 4 (Ctrl: save)',
  attackMove: 'Attack-move',
  stop: 'Stop',
  scatter: 'Scatter',
  attackGround: 'Fire at ground',
  deploy: 'Deploy · unload · ability',
  patrol: 'Patrol · primary factory',
  guard: 'Guard · escort',
  formation: 'Cycle formation (Shift: back)',
  layMines: 'Lay mines',
  stanceAggressive: 'Stance: aggressive',
  stanceGuard: 'Stance: guard',
  stanceHold: 'Stance: hold position',
  stancePassive: 'Stance: hold fire',
  selectCombat: 'All combat units',
  selectType: 'Selected types on screen',
  selectScreen: 'Everything on screen',
  nextIdle: 'Next idle unit (Shift: harvester)',
  army: 'Army overview',
  selectDamaged: 'Select damaged units',
  sendRepair: 'Send damaged units to repair',
  sell: 'Sell',
  repair: 'Repair',
  powers: 'Commander powers (then 1–9)',
  speedDown: 'Game speed down',
  speedUp: 'Game speed up',
  photo: 'Photo mode',
});

/** Subtitles. */
export const SUB_TEXT = liveStrings('a11y.subtitles', {
  announcer: 'Announcer',
  region: 'Subtitles',
} as const);

/** In-battle messages that name a key. */
export const BATTLE_TEXT = liveStrings('a11y.battle', {
  bookmarkSaved: 'Camera position {key} saved',
  bookmarkEmpty: 'No camera position on {key} yet: Ctrl + {key} saves one',
} as const);

/** Accessible names for icon-only buttons and live regions. */
export const ARIA_TEXT = liveStrings('a11y.aria', {
  toasts: 'Notifications',
  eventLog: 'Event log',
  clearLog: 'Clear the event log',
  close: 'Close',
  previous: 'Previous',
  next: 'Next',
  radio: 'Radio transmission',
  copyLink: 'Copy link',
  repairMode: 'Repair mode',
  sellMode: 'Sell mode',
  fullscreen: 'Fullscreen',
  settings: 'Settings',
  dismiss: 'Dismiss',
  multiplayer: 'Multiplayer',
} as const);
