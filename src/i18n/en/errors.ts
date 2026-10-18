/**
 * Error screens (src/platform/errors.ts, src/platform/webgl.ts): the crash screen, the "recovered from an error"
 * notice, the unsupported-browser screen and the GPU reset overlay. The copied reports stay in English.
 * {game} is the game's name (never translated).
 */
import { strings } from '../core';

export default strings('errors', {
  toast: {
    title: 'Recovered from an error',
    dismiss: 'Click to dismiss',
  },
  fatal: {
    title: 'Something went wrong',
    // the simulation stopped after the error
    halted: 'Simulation halted',
    body: 'The game hit an unexpected error and stopped to protect your session. You can return to the main menu, reload the page, or copy a report for the developers.',
    unknown: 'Unknown error',
    returnToMenu: 'Return to menu',
    reload: 'Reload',
    copyDiagnostics: 'Copy diagnostics',
    copyReport: 'Copy error report',
    copied: 'Copied ✓',
    copyFailed: 'Copy failed',
    copiedStatus: 'Report copied to the clipboard — paste it into a bug report.',
    copyFailedStatus: 'Clipboard unavailable: the report was printed to the browser console.',
    logged: '{n, plural, one {# error logged} other {# errors logged}}',
  },
  unsupported: {
    title: "Can't start on this browser",
    generic: "This browser can't run {game}.",
    webgl1: 'Your browser only supports WebGL 1, but {game} needs WebGL 2.',
    noWebgl: "Your browser doesn't support WebGL, which {game} needs for its 3D graphics.",
    contextFailed: 'Your browser supports WebGL 2, but could not start it. Hardware acceleration may be turned off, or the graphics driver is blocklisted.',
    missingFeature: 'Your graphics hardware is missing features {game} needs.',
    noWebglAdvice1: 'Use a current version of Chrome, Edge, Firefox or Safari (15 or newer).',
    noWebglAdvice2: 'If you are on a remote desktop or virtual machine, try a regular desktop session.',
    webgl1Advice1: 'Update your browser: every current Chrome, Edge, Firefox and Safari (15+) supports WebGL 2.',
    webgl1Advice2: 'On Safari 14 and older, enable "WebGL 2.0" under Develop › Experimental Features, or update macOS / iOS.',
    contextAdvice1: 'Turn on hardware acceleration (Chrome / Edge: Settings › System › "Use graphics acceleration when available"; Firefox: Settings › Performance).',
    contextAdvice2: 'Update your graphics driver, then restart the browser.',
    contextAdvice3: 'Close other tabs or apps using the GPU heavily, then try again; a crashed GPU process is reset by restarting the browser.',
    featureAdvice1: 'Try another browser on this device (Chrome and Firefox use different graphics back-ends).',
    featureAdvice2: 'Update your graphics driver, or play on a device with a more capable GPU.',
    details: 'Technical details',
    checkWebgl: 'Check WebGL 2 ↗',
    tryAgain: 'Try again',
  },
  gpuReset: {
    title: 'Graphics device reset',
    restoring: 'Restoring…',
    body: 'Your graphics driver reset the GPU. Hold on while we bring the battlefield back — the game is paused and nothing is lost.',
    stillWaiting: 'Still waiting for the GPU',
    reload: 'Reload game',
  },
});
