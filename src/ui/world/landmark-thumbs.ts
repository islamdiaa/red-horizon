/**
 * Bridge to the landmark thumbnails (src/render/landmarks: landmarkThumb, a cached PNG data URL with a
 * transparent background). Its own lazy chunk: the globe shows first, the icons fill in.
 */
import { landmarkThumb } from '../../render/landmarks';
import type { LandmarkId } from '../../conquest/world/types';

export function thumbFn(): (id: string) => string | HTMLCanvasElement | null {
  return (id) => landmarkThumb(id as LandmarkId, 96) || null;
}
