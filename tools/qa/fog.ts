// QA: fog of war & visibility (simulation side). node --import tsx tools/qa/fog.ts
import { building, check, flatMap, info, makeWorld, run, summary, unit } from './lib';

{
  const w = makeWorld(flatMap(64, 64), undefined, { fog: true });
  const p = w.players[0], e = w.players[1];
  const scout = unit(w, p, 'e1', 10.5, 10.5);
  const foe = unit(w, e, '2tnk', 30.5, 10.5);
  run(w, 0.5);
  check('Enemy unit outside sight is not visible', !w.canSee(p, foe));
  check('Own units always visible', w.canSee(p, scout));
  // a tank idle 7 cells away (beyond rifle sight 4) is not auto-targeted
  foe.x = 16.5;
  run(w, 3);
  check('Idle unit does not auto-target an enemy it cannot see', scout.target === null && foe.hp === foe.maxHp);
  // move into sight
  foe.x = 13.0;
  run(w, 1);
  check('Enemy becomes visible inside sight radius', w.canSee(p, foe));
  // explored stays explored
  const idx = w.map.idx(30, 10);
  check('Unexplored cells far away are not explored', !p.explored[idx]);
  scout.x = 28.5;
  run(w, 0.5);
  scout.x = 10.5;
  run(w, 0.5);
  check('Explored flag persists after leaving', p.explored[idx] === 1 && !p.visible[idx]);
  // buildings: visible if any footprint cell visible
  const fact = building(w, e, 'fact', 40, 40);
  run(w, 0.3);
  check('Enemy building in shroud not visible', !w.canSee(p, fact));
  const s2 = unit(w, p, 'e1', 36.5, 41.5);
  run(w, 0.5);
  check('Enemy building visible when one footprint cell is seen', w.canSee(p, fact));
  void s2;
}
{
  // Attack orders on targets that leave vision: units still chase with perfect knowledge
  const w = makeWorld(flatMap(64, 64), undefined, { fog: true });
  const p = w.players[0], e = w.players[1];
  const t = unit(w, p, '2tnk', 10.5, 30.5);
  const foe = unit(w, e, 'jeep', 14.5, 30.5);
  run(w, 0.3);
  w.issue({ c: 'attack', player: 0, units: [t.id], target: foe.id });
  w.issue({ c: 'move', player: 1, units: [foe.id], x: 60.5, y: 60.5 });
  run(w, 25);
  info(`Tank chasing a jeep that left its sight: tank at (${t.x.toFixed(1)},${t.y.toFixed(1)}), order=${t.order.type}, target visible=${w.canSee(p, foe)} (chases into fog with exact position)`);
}
{
  // Defensive structures and their sight
  const w = makeWorld(flatMap(64, 64), [{ faction: 'soviet', human: true }, { faction: 'allies' }], { fog: true });
  const p = w.players[0], e = w.players[1];
  building(w, p, 'apwr', 2, 2); building(w, p, 'apwr', 2, 6);
  const tsla = building(w, p, 'tsla', 20, 20);
  const arty = unit(w, e, 'arty', 20.5, 30.5); // 9.5 cells away > Tesla range 8.5, < arty range? (6) no
  run(w, 0.3);
  info(`Tesla sight ${tsla.bt.sight} vs range 8.5; artillery range 6: Tesla sees arty at 10 cells: ${w.canSee(p, arty)}`);
}
{
  // AI knowledge: does the AI target structures it has never seen?
  const w = makeWorld(flatMap(96, 96), [{ faction: 'allies', human: true }, { faction: 'soviet', ai: 'normal' }], { fog: true });
  const p = w.players[0], ai = w.ais[0] as any;
  building(w, p, 'fact', 80, 80);
  building(w, w.players[1], 'fact', 10, 10);
  run(w, 0.5);
  const seen = w.players[1].explored[w.map.idx(81, 81)];
  const tgt = ai.pickAttackTarget();
  info(`AI has explored the human base: ${!!seen}; AI pickAttackTarget() -> ${tgt ? tgt.map((v: number) => v.toFixed(0)).join(',') : null} (AI targets unexplored enemy bases: map-hack)`);
}
process.exit(summary() ? 1 : 0);
