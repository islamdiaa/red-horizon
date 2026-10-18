/**
 * English text of the game modes that runs inside the simulation (objectives, radio lines, end reasons, challenge
 * results) or is stored in challenge files and setups (built-in and moment challenges, Quick Battle info). Plain data,
 * no i18n imports: the relay / verification server bundles reach these modules. src/i18n/en/modes.ts registers this
 * tree (sourceStrings, keys modes.src.*), and the screens that show the text translate it with trSource().
 */
export const MODES_EN = {
  /** Radio speakers. */
  speaker: {
    challenge: 'Challenge',
    battleControl: 'Battle Control',
    intelligence: 'Intelligence',
  },
  challenge: {
    goal: {
      win: 'Defeat every enemy within {time}',
      survive: 'Survive for {time}',
      destroy: 'Destroy the target within {time}',
      protect: 'Protect the target for {time}',
      hold: 'Hold the zone for {hold} within {time}',
    },
    // hold-the-zone progress while enemy units are in the zone too
    contested: '{held} / {need} · contested',
    timerHold: 'Hold out',
    timerLeft: 'Time left',
    reason: {
      victory: 'Victory',
      defeat: 'Defeat',
      allLost: 'All forces lost',
      enemiesDestroyed: 'All enemy forces destroyed',
      overrun: 'Your forces have been overrun',
      outOfTime: 'Out of time',
      targetsDestroyed: 'Targets destroyed',
      targetDestroyed: 'Target destroyed',
      protectedLost: 'Protected target lost',
      targetLost: 'Target lost',
      heldOut: 'You held out',
      survived: 'You survived',
      zoneHeld: 'Zone held',
    },
    bonus: {
      time: 'Time bonus',
      condition: 'Condition bonus',
      base: 'Base intact',
    },
  },
  koth: {
    title: 'King of the Hill',
    objective: 'Hold the hill alone for {time}',
    intro: 'King of the Hill: the first commander to hold the marked hill for {time} wins. Enemy units on the hill contest it.',
    youHeld: 'You held the hill for {time}',
    theyHeld: '{team} held the hill for {time}',
    weHold: 'We hold the hill. Keep enemy units off it to keep the clock running.',
    taken: '{team} has taken the hill! Push them off it.',
    warning: '{team} has held the hill for {held} of {target}!',
    team: 'Team {n}',
  },
  /** Built-in challenges (titles, descriptions, objectives, radio). */
  builtin: {
    lastBastion: {
      title: 'Last Bastion',
      description: 'A Soviet tank army is rolling on the last Allied base in the pass. Keep the Construction Yard standing for five minutes.',
      goal: 'Keep your Construction Yard standing for 5:00',
      wave: 'Soviet wave {n} of 4 is on its way!',
    },
    armouredClash: {
      title: 'Armoured Clash',
      description: 'Two tank columns meet in the open desert. No base, no reinforcements: destroy the Soviet column within four minutes.',
      goal: 'Destroy the Soviet column within 4:00',
    },
    decapitation: {
      title: 'Decapitation',
      description: 'Tanya and a light strike group are behind the lines. Blow up the Soviet Construction Yard before the garrison regroups: six minutes.',
      goal: 'Destroy the Soviet Construction Yard within 6:00',
    },
    crossroads: {
      title: 'Crossroads',
      description: 'The Soviets hold the crossroads. Take it and keep it clear of enemy units for two minutes; counter-attacks come every minute.',
      goal: 'Hold the crossroads for 2:00 within 6:00',
      counter: 'Soviet counter-attack inbound to the crossroads!',
    },
  },
  /** Challenges made from a match's key moments ({at} = the moment's battle time, m:ss). */
  moment: {
    nuke: {
      title: 'Incoming!',
      goalKeep: 'Keep your base standing through the atomic strike: 3:00',
      textKeep: '{at}: an enemy nuke is in the air. Weather the strike and keep your base standing for three minutes.',
      goalSurvive: 'Survive the atomic strike and its aftermath: 4:00',
      textSurvive: '{at}: an enemy nuke is in the air. Survive for four minutes.',
    },
    siege: {
      title: 'Under Siege',
      goalKeep: 'Break the siege: keep your Construction Yard for 3:00',
      textKeep: '{at}: {money} of enemy armour broke into your base. Hold it for three minutes.',
      goalSurvive: 'Survive the siege: 3:00',
      textSurvive: '{at}: the enemy is in your base. Survive three minutes.',
    },
    comeback: {
      title: 'Against the Ropes',
      goal: 'Come back and win within 15:00',
      // {share}: your share of the battlefield strength, in percent
      text: '{at}: you were down to {share}% of the battlefield strength. Can you win from here, faster?',
      textWon: '{at}: you were down to {share}% of the battlefield strength. You won anyway. Can you win from here, faster?',
    },
    swing: {
      title: 'Turning Point',
      goal: 'Turn the battle around and win within 15:00',
      text: '{at}: a minute of fighting cost you {money} more in armour than the enemy. Replay it and turn it around.',
    },
  },
  /** Quick Battle: a generated battlefield's name (stored with the setup). */
  quick: {
    generated: 'Generated {w}×{h}',
    aiCommander: 'AI commander',
  },
  /** Default title of a challenge made at a replay moment ({map} = battlefield, {time} = battle time, m:ss). */
  authorTitle: {
    win: 'Win from here · {map} {time}',
    survive: 'Hold on · {map} {time}',
    destroy: 'Strike · {map} {time}',
    protect: 'Defend · {map} {time}',
    hold: 'Hold the ground · {map} {time}',
  },
} as const;

/** Fill {name} placeholders (English: values are already formatted, times as m:ss). */
export function fillEn(tpl: string, params: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m);
}
