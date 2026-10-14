/** Shared weather types (kept separate so helpers can import them without cycles). */
export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'dust';

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'rain', 'storm', 'snow', 'fog', 'dust'];

/** Climate of a map, biases which weather `randomWeatherSequence` produces. */
export type Climate = 'temperate' | 'winter' | 'desert';

/** One step of a weather schedule: switch to `kind` (cross-fading over `fade` s), then hold it for `duration` s. */
export interface WeatherStep {
  kind: WeatherKind;
  duration: number;
  /** Suggested cross-fade time in seconds for `Weather.set(kind, fade)`. */
  fade: number;
}
