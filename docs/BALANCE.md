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
- **Difficulty is a curve, measured against people.** Five levels, each measured against scripted stand-ins for
  real players (a novice, a casual and an experienced commander). Recruit and Easy must lose to a newcomer most of the
  time, Normal is an even fight for a casual player, Hard for an experienced one, and Brutal beats them. The easy
  levels are weak because they *use less*, not because they cheat less: under Commander rules the full AI's economy
  (tiers, processors, smelter, outposts, derricks, events, powers) is worth more than any income multiplier.
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
| The difficulty curve against a passive player and after a build-up time | `node --import tsx tools/selfplay/difficulty.ts --games 6 --only passive,ceasefire` |
| Each level against the human stand-ins | `node --import tsx tools/selfplay/standins.ts --games 20` (`--personality all`, `--dynamic 1`) |

`MatchSpec.rules` (tools/selfplay/lib.ts) can patch any rule or Commander number for one batch (`patches`, e.g.
`['POWERS.funds.cooldown', 300]`), so a change can be tried before it is made.

## Difficulty levels (simulation version 3)

The user report that started this: *"the AI seems to be hard even on easy, I can't win. They collect lots of money"*.
It was right. Under Commander rules (the skirmish default) Easy beat the novice stand-in in **every** game and the
casual one in 85%, and harvested 3.7 times as much as the novice ($3,139 a minute against $857).

### The stand-ins (`tools/selfplay/standin.ts`, frozen: don't tune them to the AI)

They play through the same commands as the UI, as human players: no AI slot, so none of the AI's event, derrick or
mercenary helpers work for them. They act every few seconds of "attention", with a seeded RNG.

| Stand-in | Plays like |
|---|---|
| **Novice** | A slow build (dawdles 25 s between structures). One refinery and two Ore Trucks, power only after it has been low for 45 s, one pillbox or flame tower. Looks at its factories every 25 s and queues one unit, so they stand idle and money piles up (no silos). Attacks from minute 14, every 7 minutes, with everything it has, never retreats. Answers a raid after 15 s with half of its idle units. No commander powers, tiers or upgrades. |
| **Casual** | A sensible build with two refinery lines (two trucks each, five at most), four defences, a service depot and power planned ahead. Factories mostly busy (two queued, checked every 5 s). A medium attack every 4 minutes from minute 8 (from $4,000, growing $800 a wave) with 80% of the army, falling back at a quarter strength; the whole home army answers a raid within 3 s; repairs. Commander rules: Emergency Funds, Field Repair, Rally Cry and Reinforcements, Tier 2 at minute 10 and an Ore Processor. |
| **Experienced** | The version-2 Normal AI, frozen in `tools/selfplay/frozen/`, playing with a human's economy (build speed and income 1.0) and its own doctrine. |

### Win share of the AI against them

Balanced personality, generated land maps, 64×64 and 96×96 (20 games each, factions and start positions alternated),
a game still running at 45 minutes goes to the side ahead on material. 80 games per cell, 95% Wilson intervals.
"Before" is the version-2 build (`git archive HEAD`).

| Level | vs novice before | after | vs casual before | after | vs experienced before | after |
|---|---|---|---|---|---|---|
| Recruit | — | 0% [0–5] | — | 0% [0–5] | — | 0% [0–5] |
| Easy | 89% [80–94] | **14% [8–23]** | 44% [33–55] | **0% [0–5]** | 5% [2–12] | 0% [0–5] |
| Normal | 98% [91–99] | 99% [93–100] | 60% [49–70] | **36% [27–47]** | 44% [33–55] | 30% [21–41] |
| Hard | 99% [93–100] | 98% [91–99] | 73% [62–81] | 56% [45–67] | 83% [73–89] | **48% [37–58]** |
| Brutal | 100% [95–100] | 100% [95–100] | 88% [78–93] | 88% [78–93] | 94% [86–97] | **94% [86–97]** |

Per ruleset (40 games a cell):

| Level | Classic: novice | casual | experienced | Commander: novice | casual | experienced |
|---|---|---|---|---|---|---|
| Recruit | 0% [0–9] | 0% [0–9] | 0% [0–9] | 0% [0–9] | 0% [0–9] | 0% [0–9] |
| Easy | 13% [5–26] (was 78%) | 0% [0–9] (3%) | 0% [0–9] (8%) | 15% [7–29] (100%) | 0% [0–9] (85%) | 0% [0–9] (3%) |
| Normal | 98% [87–100] (95%) | 25% [14–40] (25%) | 53% [37–67] (33%) | 100% [91–100] (100%) | 48% [33–63] (95%) | 8% [3–20] (55%) |
| Hard | 95% [83–99] (98%) | 20% [10–35] (45%) | 53% [37–67] (73%) | 100% [91–100] (100%) | 93% [80–97] (100%) | 43% [29–58] (93%) |
| Brutal | 100% (100%) | 75% [60–86] (75%) | 98% [87–100] (98%) | 100% (100%) | 100% (100%) | 90% [77–96] (90%) |

The targets were: Recruit at most 10% against the novice; Easy at most 25% against the novice and 15% against the
casual player; Normal about 50% against the casual player; Hard at least 70% against the casual and about 50%
against the experienced player; Brutal at least 75% against the experienced player. All hold under Commander rules.
In Classic all held but Hard against the casual player (20%): in pure Red Alert rules the scripted casual player,
who masses tanks at home behind four defences and counter-attacks, beat every AI level more often than the
experienced stand-in did. Version 4 closes most of that gap with better Classic play, not more money (next section).
The Normal row also wins almost every game against the novice: Normal is the casual player's level.

### Classic: the AI's own judgement (simulation version 4)

What the AI did wrong against the casual stand-in (Classic, Hard, 40 games): it spent about $27,000 a game on
structures and $14,000 on Ore Trucks against his $16,000 and $9,000, fielded half his army (riflemen took every
credit as it came in, so the war factory waited for money it never saw), lost eight Ore Trucks a game in mid-map
fields, and sent waves into his four defences, then had nothing at home when his tanks came. Now, in Classic
skirmishes from Normal up (`AIController.classicPro`; Commander rules, Recruit, Easy and every scripted mission keep
version 3, hash for hash):

- **Tanks first** (`ai.ts`, `planUnits`): the war factory gets the money first; infantry is an escort of about 0.6
  per combat vehicle, built next to a vehicle in production or when the money floats, and ten at most before the war
  factory.
- **A lean build** (`CLASSIC_GOALS`): two refineries, the war factory, radar, three defences and the service depot
  (and the Soviet airfield, for its free support powers), then the third refinery and the tech centre; no decoys. The
  next structure on the list keeps half its price back from the tank queue. Helipads, kennels, gap generators, AA and
  superweapons, and a second war factory, wait until the bank covers most of their price or the army is ahead.
- **When to fight** (`ai-engage.ts`): an estimate of the enemy army from what it has seen (the most it saw at once,
  less what it saw destroyed, plus $300 a minute for what it can't see) and of the defences it knows at the target.
  A wave goes only when it outweighs both by a quarter, never before the scouts have found the base, and with the
  whole idle army (no capped first wave); otherwise the army waits at home among its defences. After five minutes
  with neither a wave nor a real attack on the base ($2,500 or more of enemy units; scouts and paradrops don't
  count), a ready army goes anyway (two such commanders would otherwise
  sit at home all game). A wave that meets more than it can beat comes home at once. Defenders are not fed piecemeal
  to a stronger force outside the base.
- **Ore Truck care** (`ai-harvest.ts`): a truck under fire turns back (home to unload when it carries a fair load),
  and one bound for a field on the enemy's side of the map is sent to a safer field that still has ore.

Win share of the AI in Classic (generated land maps, 64×64 and 96×96, 20 games each, factions and start positions
alternated, 45-minute limit decided on material; 40 games a cell, 95% Wilson intervals). "Before" is version 3:

| Level | vs novice | vs casual before | after | vs experienced before | after |
|---|---|---|---|---|---|
| Recruit | 0% [0–9] | 0% [0–9] | 0% [0–9] | — | — |
| Easy | 13% [5–26] | 0% [0–9] | 0% [0–9] | — | — |
| Normal | — | 25% [14–40] | **40% [26–55]** | 53% [37–67] | 58% [42–71] |
| Hard | — | 20% [10–35] | **65% [50–78]** | 53% [37–67] | 70% [55–82] |
| Brutal | — | 75% [60–86] | **85% [71–93]** | 98% [87–100] | 93% [80–97] |

Hard against the casual player triples, close to the 70% target: 95% on 64×64 but 35% on 96×96, where the AI's home
ore runs out by minute ten and its trucks travel to contested fields (earlier expansions were tried and lost more
than they won). Normal gives the casual player a fair game (40%); Hard beats the experienced player 70% of the time.
Brutal against the experienced player (93%, was 98%) is within the noise of 40 games. Recruit and Easy are unchanged.

Commander rules keep the version-3 AI (40 games a cell, before → after): Normal against the casual player 48% → 40%
[26–55], against the experienced one 8% → 18% [9–32]; Hard 93% → 90% [77–96] and 43% → 45% [31–60]; no cell moved
by more than the noise (the only shared changes are bug fixes: units are no longer ordered at targets they can't
drive to, and the ore-field map follows ore that spreads, so a loaded game plays on as it was saved).

Allied share on the curated two-player maps (both sides the same AI, normal and hard, 96 games): 32% [24–42] before,
70% [60–78] now, but 77% of the games run to the 45-minute limit (35% before) and are decided on material. Two
version-4 Classic AIs do attack each other, but the side that is ahead turns its waves back at the other's defences
(a Tesla Coil or two outweighs the wave by the 1.15 retreat line), so it wins on material, not by breaking the base.
A build with a plain five-minute limit on holding back gave 58% [48–68] with 56% timeouts, but about 15 points less
against the casual player. Two other tries did not reach 50% timeouts with a 40–60% split of the decided games and
were left out: waves that see a stalemate-breaking attack through (retreating only at 1.8 times the usual line: 79%
timeouts), and counting towers once instead of twice, health-weighted, when the wave has beaten the defending army
(68% timeouts, Allies 71% of the decided games). Still open.

Economy at a glance (harvest a minute, AI against stand-in, Commander): Easy against the novice $829 / $851 (was
$3,139 / $857); Normal against the casual player $1,682 / $1,789 (was $2,651 / $1,470).

Personalities stay distinct inside a level (all eleven in rotation, 132 games a level, both rulesets): Recruit wins
0 of 132 against the novice, Easy 20% [14–27] (26 of 132). The hardest Easy personalities are the Tesla Turtle
(44% [31–58] in 48 games: a fortress a novice can't crack) and the Armour Rusher and Saboteur (a third each, in 12);
the Guerrilla, Tycoon and Balanced Easy never won. Normal with every personality against the casual player: 42%
[31–54] under Commander rules, 5% in Classic.

**Dynamic difficulty** (on by default against Recruit and Easy, assist-only there) takes Easy against the novice from
15% to 5% [1–17] under Commander rules, Recruit stays at 0–3%, and Normal (both ways) against the casual player
goes from 48% to 55% [40–69].

### What each level uses

| | Recruit | Easy | Normal | Hard | Brutal |
|---|---|---|---|---|---|
| Build speed / ore income | 0.5 / 0.7 | 0.6 / 0.75 (was 0.65 / 0.9) | 0.95 / 1.0 | 1.05 / 1.05 (was 1.15 / 1.15) | 1.4 / 1.35 |
| Refineries / Ore Trucks at most | 1 / 2 | 2 / 3 | 3 / 6 | — | — |
| Expansions / mining outposts | none | none | 1 / 1 | 2 / 2 | 3 / any |
| Oil derricks, battlefield events | no / no | no / no | yes / 60% of events | yes / 80% | yes / all |
| Tech tiers (Commander) | Tier 1 | Tier 2, late (×3 the timing) | all, ×1.3 later | all, ×1.1 | all |
| Research | none | one Level I line, no harvesting lines | four levels in all | any | any |
| Upgrades | none | Turbines only | 2 Processors at most, no Purifier, Smelter or Logistics Centre | 3 Processors | any |
| Doctrine | none | none | yes | yes | yes |
| Commander powers | none | Field Repair only, 2 min apart | all but Tesla Storm and Sabotage, 45 s apart | all, 30 s apart | all |
| First wave / its value / growth | 15:00 / $1,800 / $400 | 12:00 / $2,500 / $700 | 7:00 / $3,500 / $1,800 | 5:00 / $3,500 / $2,000 | 3:30 / $3,500 / $2,200 |
| Wave and army caps | $3,000 / $4,000 | $6,000 / $8,000 | $12,000 / $30,000 | — | — |
| Defences, bunkers | 1, none | 2 (+1 after 15 min), none; one Tesla Coil at most | 3 (+2), 2 | 4 (+2), 3 | 5 (+2), 3 |
| Raids on harvesters, spies, thieves, mines, siege specials, superweapons | none | none | yes | yes | yes |
| Answers an intruder after / rebuilds after | 15 s / 150 s | 6 s / 60 s | 2 s / 20 s | at once | at once |

Below Normal a personality colours the level without lifting it: no extra defences for a defensive one, an aggressive
one attacks at most 15% sooner and never with a smaller wave, and no Tech Center (so no Mammoth Tanks) before minute
15. Scripted missions (campaigns, special operations, co-op, Conquest) keep the version-2 levels their balance was
built on (`MISSION_DIFF`): the campaign autopilots play out exactly as before.

### Looking for AI advantages

Every credit source in the simulation was checked for anything that pays the AI more than a human from the same
building or event:

- Ore: the difficulty's income multiplier (`incomeBias`) applies to harvested ore only, for every player; humans are
  1.0. The Ore Processor (+20%), Purifier (+25%) and Smelter (+40%) multiply it the same way for everyone
  (`oreValueMul`).
- Oil derricks ($750 a minute each), convoys, airdrops, crates, Emergency Funds, bounties and Supply Drops pay a human
  and an AI exactly the same, **and ignore the difficulty's income multiplier**. That was the leak: the old Easy was
  handicapped on ore only, then hunted derricks with engineers, escorted convoys and called Emergency Funds every five
  minutes at full value. Recruit and Easy now take no part in any of them (Easy has no Funds power), and Normal plays
  60% of the events.
- Only one mutator favours the AI by design, *Fanatics* (+35% build speed, +20% ore for AI players), and it is labelled
  so; Quick Battle never rolls it, and below Normal rolls only newcomer-safe mutators.
- Dynamic difficulty is the only other AI multiplier; it is opt-in (default on only against Recruit and Easy, where it
  can only ease off), and announced.
- Left as it is: an idle AI Ore Truck goes back to work after 4 s, a human's after 8 s (the player's grace period to
  give it orders); the AI's expansion search knows where ore fields are under the shroud. Neither earns money by
  itself.
- Classic stays Red Alert: these are AI choices, the rules tables are untouched.

### Difficulty curve against a passive player (96×96, medians of 6 seeds)

| Level | first wave | its value | a passive player loses a structure | after a 10-min build-up: grand wave (Classic / Commander) |
|---|---|---|---|---|
| Recruit | 15:00 | $2,300 | 17:54 | $1,700 / $1,700 |
| Easy | 12:00 (was 10:00) | $3,200 | 14:41 (12:40) | $3,400 / $3,500 (was $5,400 / $4,800) |
| Normal | 7:00 | $4,490 | 9:39 | $8,800 / $7,000 (was $9,600 / $8,400) |
| Hard | 5:00 | $4,500 | 7:40 | $13,200 / $12,300 (was $14,600 / $14,900) |
| Brutal | 3:30 | $4,400 | 6:07 | $18,700 / $20,600 |

## Earlier numbers (simulation version 2)

The faction, doctrine and economy measurements below were taken with version 2. Version 3 changes the AI's levels
for both sides alike (Brutal not at all), so they should hold; a version-3 check of Classic at normal and hard (96×96,
48 games) gives the Allies 41.7% [29–56], in line with the 42–47% below. Re-measure before tuning faction numbers.

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

### Mutators

No mutator turns a plan into a sure win (economy-first tycoon vs rusher, hard, Commander, 12 games each): none 0%,
Golden Ore 33%, Lightning War 25%, Golden Ore + Lightning War 58%, Mega Crates 8%, Tank Rush 8%.
