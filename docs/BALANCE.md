# Balance

How Red Horizon keeps its matches fair, and the numbers it is measured by.

## Philosophy

- **Classic is Red Alert.** Classic rules (and the campaign) keep the original RULES.INI numbers. When the
  factions don't come out even there, the fix is the AI's skill, never the rules: in Red Alert the Soviets win with
  heavy armour, Tesla Coils and their airfield's free support powers, and the Allies with what the Soviets don't
  have (Longbows, spies, artillery, cruisers, the Chronosphere). An AI that ignores those loses.
- **Commander is where numbers move.** Doctrines, command points and powers, tiers, upgrades and research are new
  systems, so their numbers are tuned freely, in `src/sim/doctrine.ts`, `src/sim/commander.ts` and
  `src/sim/economy-data.ts`.
- **No dominant plan.** Every doctrine should win 40–60% of its matchups, mirror and cross-faction. The Commander
  economy should help a commander who uses it (55–65% against one who ignores it) without deciding the match on
  its own, and a side that falls behind should still be able to come back.
- **Difficulty is a curve.** Easy has to be beatable by a newcomer: it attacks late, in small waves, and plays
  straightforwardly. Each level up is clearly stronger, and Brutal is hard.
- **Measured, not guessed.** Every number below comes from headless AI-vs-AI self-play (`tools/selfplay`),
  reported with 95% confidence intervals. Self-play is noisy: differences under about 5 points between two
  batches of a few hundred games are not significant.

## How to measure

| What | Command |
|---|---|
| Faction balance, Classic (per difficulty and map size) | `node --import tsx tools/selfplay/run.ts --mode faction --games 40 --maps land --size 64,96,128 --diff easy,normal,hard,brutal` |
| Sea and curated maps | `node --import tsx tools/selfplay/run.ts --mode faction --games 48 --maps sea,curated --diff normal,hard` |
| Doctrines, powers, comebacks (Commander) | `node --import tsx tools/selfplay/doctrine.ts --seeds 8` |
| The Commander economy on vs off | `node --import tsx tools/selfplay/economy.ts --only ablation,greed --games 24` |
| The difficulty curve | `node --import tsx tools/selfplay/difficulty.ts --games 8` |

`MatchSpec.rules` (tools/selfplay/lib.ts) can patch any rule or Commander number for one batch (`patches`, e.g.
`['POWERS.funds.cooldown', 300]`), so a change can be tried before it is made.

## Current numbers (simulation version 2)

Win share of the Allies against the Soviets, both AIs on the same difficulty and the balanced personality, slots and
start positions alternated; a game still running at 45 minutes goes to the side ahead on material.

### Classic

| | before | now |
|---|---|---|
| Generated land maps, all levels and sizes | 37.5% [33–42] (decided games 26%) | 44.8% [39–51] (decided 37%); 43.5% [39–48] in a second batch |
| Normal and hard, land, 576 games | 33% | 42–47% (three batches) |
| Sea maps (normal, hard) | 35% [26–46] | 42–49% |
| Curated two-player maps | 30% [21–41] | 29–34%: still the Soviets' ground |

Longbow exchange (value destroyed / lost) went from 0.43 to about 1.9, and the Allied army's from 0.69 to 0.80.
What moved it, all in the Allied AI (rules untouched):

- a leaner skirmish build order (third refinery and second war factory before the second turret), the
  Chronosphere and Missile Silo only once the money floats: about +10 points;
- a spy for the enemy Radar Dome by minute 7, whose shared radar feeds the AI's intel: +5;
- Longbow strikes that weigh anti-aircraft fire, avoid bases they have no fresh look at and turn back from flak,
  Tesla-aware wave targets, artillery that falls back behind the tanks, Chronosphere rescues of ore trucks:
  +2 to +4 together;
- a cruiser-first navy on sea maps: +12 there.

For scale: the Soviet airfield's free support powers (spy plane, paratroopers, parabombs) are worth about 8 points
to the Soviets, and one difficulty level about 25.

### Commander

| | before | now |
|---|---|---|
| Allied win share, all levels and sizes (192 games) | 64% [57–71] (96 and 128 maps) | 51.6% [45–59] |
| AI using the economy vs ignoring it | 53% (17/32) | 56% (18/32) |
| Economy-only commander vs rusher or balanced | 28% | 28% |
| AI using commander powers vs one that never does | 100% (64) | 95% (64) |
| Comebacks (behind by 15% at 15 min, still wins) | 18% | 13% (Classic: 2%) |

Doctrines (hard, 80×80, 8 seeds; mirror = against the faction's other doctrines and no doctrine):

| Doctrine | mirror before | mirror now | cross now (vs the other faction) |
|---|---|---|---|
| Armoured Fist | 58% | 59% | 50% |
| Human Wave | 46% | 41% | 66% |
| Tesla Doctrine | 55% | 42% | 63% |
| Iron Rain | 48% | 59% | 61% |
| Blitzkrieg | 59% | 42% | 39% |
| Fortress Europe | 48% | 50% | 43% |
| Precision Strike | 45% | 54% | 41% |
| Shadow Network | 48% | 60% | 50% |

Every mirror is within 40–60%. A cross-faction cell is 8 games, so a row (40 games) has a confidence interval of
about ±15 points; at hard on 80×80 the Soviets lead the cross table (58%) while on 96 and 128 the Allies did (55%).

Changed numbers:

| Number | Was | Now | Why |
|---|---|---|---|
| Composite Armour I / II | −10% / −20% damage | −8% / −15% | worth 6 points of Allied win share on its own |
| Precision Optics I / II | +10% / +20% range | +6% / +12% | the same: range decides tank duels |
| Ore Smelter (Soviet) | +25% ore value | +40% (Purifier stays +25%) | the economy's extra money favoured the faction that scales; −5 points of Allied share |
| Emergency Funds recharge | 210 s | 300 s | a third less free money per match |
| Reinforcements recharge | 210 s | 270 s | fewer free tank columns |
| Elite Training recharge | 120 s | 180 s | fewer free veterans |
| Artillery Barrage recharge | 100 s | 120 s | |
| AI research choice | by unit counts | by the value of the army each line improves | the Soviet AI researched Conscription before Reactive Armour |

### Difficulty curve (96×96, medians of 6 seeds)

| Level | first wave | its value | a passive player loses a structure | after a 10-min build-up: grand wave (Classic / Commander) |
|---|---|---|---|---|
| Easy | 10:00 | $4,100 | 12:40 | $5,400 / $4,800 (was $8,200 / $6,050) |
| Normal | 7:00 | $4,500 | 9:40 | $9,600 / $8,400 (was $10,500 / $9,950) |
| Hard | 5:00 | $4,500 | 7:40 | $14,600 / $14,900 |
| Brutal | 3:30 | $4,400 | 6:07 | $18,700 / $20,600 |

Against a new-player stand-in (the frozen legacy AI on easy, Classic): Easy wins 58%, Normal 92%, Hard 92%,
Brutal 100%. Quick Battle now keeps a player on Easy until they beat it half the time (one win in ten no longer
promotes them).

No mutator turns a plan into a sure win (economy-first tycoon vs rusher, hard, Commander, 12 games each): none 0%,
Golden Ore 33%, Lightning War 25%, Golden Ore + Lightning War 58%, Mega Crates 8%, Tank Rush 8%.
