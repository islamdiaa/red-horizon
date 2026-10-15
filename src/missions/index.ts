import type { MissionDef } from '../sim/mission';
import { ALLIED_MISSIONS } from './allied';
import { SOVIET_MISSIONS } from './soviet';
import { SPECIAL_MISSIONS } from './special';

const ALL: MissionDef[] = [...ALLIED_MISSIONS, ...SOVIET_MISSIONS, ...SPECIAL_MISSIONS];
export const MISSIONS: Record<string, MissionDef> = Object.fromEntries(ALL.map((m) => [m.id, m]));

export function getMission(id: string): MissionDef | undefined {
  return MISSIONS[id];
}

export function campaignMissions(c: 'allies' | 'soviet' | 'special'): MissionDef[] {
  return ALL.filter((m) => m.campaign === c).sort((a, b) => a.index - b.index);
}
