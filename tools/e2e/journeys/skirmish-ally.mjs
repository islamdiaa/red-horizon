// Skirmish with an AI ally (2 vs 2): add two opponents, switch the first to your side with the handshake button on
// its row, check the last opponent can't be switched too, deploy, and check the match puts that AI on your team
// against the other two; back in the menu the panel remembers the ally.
const P = '.main-screen:not(.leaving) .mm-panel';

export default async function skirmishAlly(bot) {
  await bot.goto();
  await bot.waitMenu();
  await bot.click(`${P} .op-add`);
  await bot.click(`${P} .op-add`);
  const n = await bot.page.locator(`${P} .opponent`).count();
  bot.check(n === 3, 'three AIs on the panel', n);
  bot.check(await bot.page.locator(`${P} .opponent .op-ally`).count() === 3, 'every AI row has an ally switch');
  await bot.click(`${P} .opponent >> nth=0 >> .op-ally`);
  const st = await bot.page.evaluate((P) => [...document.querySelectorAll(`${P} .opponent`)].map((r) => ({ ally: r.classList.contains('ally'), on: !!r.querySelector('.op-ally.on'), dis: !!r.querySelector('.op-ally')?.disabled, name: r.querySelector('.op-id b')?.textContent })), P);
  bot.check(st[0].ally && st[0].on && /ally/i.test(st[0].name ?? ''), 'the first AI is now an ally (switch lit, named "Ally 1")', st);
  // two opponents left: both may still switch; switch the second too, then the third must stay an opponent
  await bot.click(`${P} .opponent >> nth=1 >> .op-ally`);
  const last = await bot.page.evaluate((P) => { const b = document.querySelectorAll(`${P} .opponent .op-ally`)[2]; return { dis: b?.disabled, tip: b?.title }; }, P);
  bot.check(last.dis, 'the last opponent cannot become an ally too', last);
  await bot.click(`${P} .opponent >> nth=1 >> .op-ally`); // (back to an opponent: 1 ally, 2 opponents)
  for (let i = 0; i < 3; i++) await bot.click(`${P} .opponent >> nth=${i} >> .op-diff button[data-v="easy"]`);
  await bot.shot('panel');
  await bot.click(`${P} .deploy`);
  await bot.waitMatch();
  const m = await bot.g((g) => ({
    me: g.local.team, allies: g.world.players.filter((p) => p !== g.local && !g.local.isEnemy(p)).map((p) => p.team),
    foes: g.world.players.filter((p) => g.local.isEnemy(p)).map((p) => p.team), ais: g.world.ais.length,
    opp: g.setup.opponents.map((o) => `${o.difficulty}${o.ally ? '+ally' : ''}`),
  }));
  bot.check(m.allies.length === 1 && m.allies[0] === m.me && m.foes.length === 2 && m.ais === 3, 'the match: one AI on your team, two against you', m);
  await bot.wait(60);
  const stillOn = await bot.g((g) => !g.world.gameOver && !g.local.defeated);
  bot.check(stillOn, 'the match plays on (no instant victory or defeat)');
  await bot.shot('match');
  await bot.quitToMenu();
  const kept = await bot.page.evaluate((P) => [...document.querySelectorAll(`${P} .opponent`)].map((r) => r.classList.contains('ally')), P);
  bot.check(kept.length === 3 && kept[0] && !kept[1] && !kept[2], 'the panel remembers the ally', kept);
  await bot.noErrors('skirmish with an ally');
}
