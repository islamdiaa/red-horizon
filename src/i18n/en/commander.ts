/** The Commander powers panel (src/ui/commander.ts): Commander rules, command points (CP), the power tree. */
import { strings } from '../core';

export default strings('commander', {
  panel: {
    // the small label above the commander level in the panel header
    command: 'Command',
    // abbreviation of "command points"
    cp: 'CP',
    level: 'Level {n}',
    // the panel's tooltip when no doctrine is chosen
    title: 'Commander',
    // header tooltip: the doctrine, its two bonuses and its drawback
    doctrineTip: '{name}: {bonus1}; {bonus2}; {drawback}',
    // a tier's unlock cost in command points
    tierCost: '{n} CP',
    // a closed tier: the commander level that opens it ("Lv" = level)
    tierLevel: 'Lv {n}',
    // keyboard hint under the tree: {key} arms the powers, then a number key picks one
    hint: '[kbd]{key}[/kbd] then [kbd]1[/kbd]–[kbd]{max}[/kbd]',
  },
  tip: {
    tier: 'Tier {tier}',
    cooldown: '{s} s cooldown',
    aimStructure: 'aim at a structure',
    aimed: 'aimed',
    recharging: 'Recharging: {s} s',
    ready: 'Ready',
    opensAt: 'Tier {tier} opens at commander level {level}',
    unlock: 'Unlock: {n} CP',
  },
  msg: {
    firstHint: 'Commander rules: you have {n, plural, one {# command point} other {# command points}}. Unlock your first power in the Command panel (T, then 1–3).',
    tierLocked: '{power}: reach commander level {level} to open tier {tier}',
    needPoints: '{power} needs {cost, plural, one {# command point} other {# command points}} (you have {have})',
    recharging: '{power} recharging: {s} s',
    aimStructure: '{power}: click an enemy structure (right click to cancel)',
    aimArea: '{power}: click the target area (right click to cancel)',
    sabotageNoTarget: '{power}: pick an enemy structure you have seen',
    levelTierOpen: 'Commander level {n}: tier {tier} powers open',
    level: 'Commander level {n}',
    unlocked: '{power} unlocked',
    stormIncoming: 'Warning: Tesla Storm incoming!',
    barrageIncoming: 'Warning: artillery barrage incoming!',
    elite: '{power}: your next {n, plural, one {# combat unit arrives as a Veteran} other {# combat units arrive as Veterans}}',
    // floating text over a sabotaged enemy structure
    sabotaged: 'SABOTAGED',
  },
});
