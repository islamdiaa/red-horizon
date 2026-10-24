import { Rng } from './rng';
import type { Climate, WeatherKind, WeatherStep } from './types';

/**
 * A natural-feeling weather schedule for a match: long clear spells, occasional rain that may build
 * into a thunderstorm and ease off again, and rarer snow / fog / dust depending on the climate (tropical: the monsoon).
 * Consecutive steps never repeat a kind. Durations are hold times (seconds) after the cross-fade.
 *
 *   const plan = randomWeatherSequence(seed, 'temperate');
 *   // every time the current step's duration runs out:  weather.set(step.kind, step.fade)
 */
export function randomWeatherSequence(seed: number, climate: Climate = 'temperate', totalSeconds = 3600): WeatherStep[] {
  const rng = new Rng(((seed | 0) * 7919 + 104729) >>> 0);
  const out: WeatherStep[] = [];
  let total = 0;
  const push = (kind: WeatherKind, a: number, b: number, fade: number) => {
    const d = Math.round(rng.range(a, b));
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.duration += d;
    else out.push({ kind, duration: d, fade });
    total += d + fade;
  };
  const rainSpell = (stormChance: number) => {
    push('rain', 60, 150, 20);
    if (rng.next() < stormChance) {
      push('storm', 50, 130, 12);
      push('rain', 40, 100, 15);
    }
  };

  // matches open with a long clear spell
  push('clear', 150, 360, 0);
  while (total < totalSeconds) {
    const r = rng.next();
    if (climate === 'winter') {
      if (r < 0.45) push('snow', 150, 330, 30);
      else if (r < 0.65) push('fog', 100, 220, 25);
      else if (r < 0.73) rainSpell(0.15);
      push('clear', 140, 330, 25);
    } else if (climate === 'tropical') {
      // monsoon (World Conquest, MAPS): long heavy rains that often break into thunderstorms, steamy fog, never snow
      if (r < 0.6) { push('rain', 90, 220, 18); if (rng.next() < 0.6) { push('storm', 60, 160, 10); push('rain', 50, 120, 14); } }
      else if (r < 0.75) push('fog', 80, 180, 25);
      push('clear', 110, 260, 20);
    } else if (climate === 'desert') {
      if (r < 0.42) push('dust', 70, 170, 18);
      else if (r < 0.49) rainSpell(0.45);
      else if (r < 0.52) push('fog', 70, 140, 25);
      push('clear', 180, 400, 25);
    } else {
      if (r < 0.45) rainSpell(0.45);
      else if (r < 0.58) push('fog', 90, 200, 25);
      else if (r < 0.615) push('snow', 100, 200, 30);
      else if (r < 0.63) push('dust', 60, 120, 20);
      push('clear', 150, 360, 25);
    }
  }
  return out;
}
