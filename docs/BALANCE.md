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
- **Difficulty is a curve, measured against people.** Five levels, each measured against scripted stand-ins for real
  players (a first-time newcomer, a novice, a casual and an experienced commander), where players meet them (Quick
  Battle and the skirmish menu's defaults). Recruit and Easy must lose to a newcomer most of the time, Normal is an
  even fight for a casual player, Hard for an experienced one, and Brutal beats them. The easy levels are weak because
  they *use less*, not because they cheat less: under Commander rules the full AI's economy (tiers, processors,
  smelter, outposts, derricks, events, powers) is worth more than any income multiplier.
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
| Each level where players meet it: Quick Battle rolls and the skirmish menu's defaults, against the stand-in each level is measured against | `node --import tsx tools/selfplay/levels.ts --games 60` (`--cond qb,custom`, `--rules commander,classic`, `--pairs all`, `--patch`, `--tune`) |
| Team play (2v2 with an AI teammate), free-for-alls and navies at every level | `node --import tsx tools/selfplay/teams.ts --games 16` (`--mode 2v2,ffa,naval`, `--map archipelago`) |
| One match as the game sets it up, with snapshots of both sides (what the AI spent, fields and builds) | `node --import tsx tools/selfplay/trace.ts --qb 77 --diff recruit --vs newcomer --at 3,7,15` (`--autostart <seed>`, `--vs ai:<level>`) |
| Why the AI wins or loses (its waves and how they ended, armies against its estimate, Ore Trucks lost, spending) and what is left of a beaten side | `levels.ts ... --probe ai` (and `run.ts ... --probe ai`: why AI-vs-AI games time out) |
| A beaten player's last units hiding: how long each level takes to find and finish them | `node --import tsx tools/selfplay/endgame.ts --games 16` |

`MatchSpec.rules` (tools/selfplay/lib.ts) can patch any rule or Commander number for one batch (`patches`, e.g.
`['POWERS.funds.cooldown', 300]`), so a change can be tried before it is made.

## Finishing matches and Classic Hard (simulation version 6)

The user's words after version 5: *"fix remaining items, test further extensively, ensure it's flawless"*. Version 5
left Classic Hard off the curve (38% against the casual stand-in, 68% against the experienced one), most Classic
AI-vs-AI games on the curated maps running to the time limit, newcomers who beat Recruit or Easy unable to finish
them, a beaten player's last units never hunted down, and AI teammates on the easy levels that rarely came to help.

### Why Classic Hard lost to the casual player

`levels.ts --probe ai` records what the AI thinks and does. Classic Hard against the casual stand-in (120 games,
version 5 judgement plus this round's hunting and surrender, before the changes below):

| | Against the casual stand-in | Against the experienced one |
|---|---|---|
| AI army against the human's, minutes 8 / 12 / 20 (median) | 0.8 / 0.8 / 0.2 (96×96) and 0.8 / 0.9 / 0.7 (Quick Battle) | 1.1–1.3 / 1.4–1.8 / 1.4–1.7 |
| Its estimate of the enemy army against the truth (minute 12) | 1.0 | 1.0–1.1 |
| Waves a game; how they ended (broken / fell back / went on) | 1.7–2.1; 17–20% / 77–78% / 3–6% | 2.0–2.3; 25–28% / 66–68% / 6–7% |
| Value its waves destroyed for each unit of value they lost | 1.5–1.8 | 2.5 |
| Ore Trucks lost a game (at home / mid-map / enemy side) | 6.2 (2.4 / 2.7 / 0.6) | 3.1 |
| Spent on structures / on units (a game) | $29,000–30,000 / $40,000–60,000; the casual player $16,000–17,000 / $61,000–65,000 | about even |

The AI read the enemy correctly and its waves traded well, but it threw its first wave at minute 5–6 into a base with
the casual player's whole army at home, then met his first attack (minute 8–10, heavy and medium tanks) with what was
left, and kept buying structures (a third and fourth refinery, expansions, a second war factory, the tech centre,
rebuilt turrets: four refineries placed a game) while it was behind. Experiments, 120 games each (Classic Hard; the
Quick Battle rolls and the 96×96 menu default; the same seeds in every row):

| Classic Hard | vs casual | vs experienced |
|---|---|---|
| Before (this round's hunting, surrender and review fixes, nothing else) | 42% [33–51] | 75% [67–82] |
| First wave not before 10:00 / 11:00 / 13:00 / 15:00 unless an enemy attack broke on its base | 48% / 51% / 51% / 50% | 68% / 64% / 58% / 58% |
| A counter-attack after the enemy's attack broke goes in with 70% of what it would need | 43% | 76% |
| The luxuries wait while its army is behind its estimate of the enemy's ("thrift") | 45% | 78% |
| First wave at 11:00 + thrift (two seed sets: 63% and 53%) / 13:00 + thrift | 58% / 60% | 69% / 64% |
| … + its artillery shells the defences it outranges (V2 rockets 10 cells, against a Tesla Coil's 8.5) | 50% (11:00, no thrift) | 62% |
| … + Ore Trucks flee an enemy column seen within 12 cells (truck losses did not change) | 70% (noise) | 71% |

The lever was patience: an early wave thrown into a fortified base is an army missing when the enemy's first attack
comes, and the thrift keeps the money in tanks while the army is behind. Holding later than 13:00 bought nothing more;
the counter-attack and the truck flight did nothing measurable and were left out.

### What changed (judgement only; no rules number moved)

- **The Classic commander masses first** (`DiffParams.classicFirst`, Hard: 13:00). Its waves still wait until they
  outweigh what it knows of the enemy; an enemy attack that breaks on its base is still answered at once.
- **Thrift** (`DiffParams.classicThrift`, Normal and Hard, the first 25 minutes): while its army is behind its estimate
  of the enemy's, the tech centre, the extras (helipad, kennel, gap generator, AA, superweapons), a second war factory, a
  third refinery and expansions wait whatever the bank, unless the ore at home is running out or the commander is an
  economist by taste. After 25 minutes, a long war, they come back.
- **Artillery sieges** (`AITuning.proBombard`, Classic Normal and up): a wave's V2 rockets and howitzers shell the
  known defences round its target that they outrange, all on the same one, from out of their reach. An attack order
  on a structure it has seen is obeyed through the fog, as a player's would be (a V2 kills a Tesla Coil from 10 cells
  without being touched).
- **A long war** (`AITuning.proLate`, from 25 minutes, Classic Normal and up): a wave needs a quarter less to set out
  and turns back only from 1.5 times its own strength.
- **Broke** (every skirmish level): with no Ore Truck left, an empty bank and ore still on the map, the AI cancels an
  expansion MCV waiting in its queue and sells what it can spare, one structure at a time, until a truck is paid for.
  Two Hard AIs on a mined-out 96×96 map used to sit out the rest of the match with $2 and a truck half paid for.

`tools/selfplay/levels.ts --games 60` (240 games a row: Quick Battle rolls and the menu default, Classic and Commander
rules), version 5 against version 6:

| Level vs stand-in | Target | Version 5 | Version 6 | Classic (v5 → v6) | Commander (v5 → v6) |
|---|---|---|---|---|---|
| Recruit vs newcomer | ≤ 15% | 9% [6–13] | 9% [6–13] | 8% → 7% | 10% → 11% |
| Recruit vs novice | ≤ 5% | 2% [1–5] | 2% [1–5] | 2% → 3% | 2% → 2% |
| Easy vs newcomer | ≤ 40% | 31% [26–37] | 33% [27–39] | 28% → 30% | 34% → 36% |
| Easy vs novice | ≤ 20% | 7% [4–11] | 8% [5–12] | 12% → 10% | 2% → 5% |
| Easy vs casual | ≤ 10% | 0% [0–2] | 0% [0–2] | 0% → 0% | 0% → 0% |
| Normal vs casual | 40–60% | 47% [41–53] | 45% [38–51] | 46% → 45% | 48% → 44% |
| Hard vs casual | ≥ 60% | 55% [49–62] | **63% [57–69]** | 38% → **47%** | 72% → 79% |
| Hard vs experienced | 40–65% | 60% [53–66] | **52% [46–59]** | 68% → **56%** | 52% → 49% |
| Brutal vs experienced | ≥ 80% | 92% [88–95] | 90% [86–94] | 92% → 89% | 93% → 92% |

A second set of seeds for Classic (`--seed 2`, 120 games a row) gave Normal 48%, Hard against the casual player 54% and
against the experienced one 61%. Both sets pooled, Classic Hard is at **50% [44–57]** against the casual stand-in (38% in
version 5) and **58% [52–64]** against the experienced one (68%); Classic Normal 47% [40–53]. The 96×96 menu default stays
the hard case for Classic Hard against the casual player (38% and 47% on the two sets; 27% in version 5), the Quick Battle
rolls the easier one (55% and 62%; 50%).

### A beaten side ends

- **Hunting** (every skirmish level): with an enemy still in the game and nothing of him known (no structure, no start
  left to look at, no unit seen for 30 seconds), the whole army fans out in parties of three, each to a different square
  of open ground it has gone longest without seeing, attack-moving. The version-5 search sent one wave as a single
  column while the rest of the army waited at home, and judged each 8-cell square by its centre cell, so a square whose
  centre was a tree or rock was never searched: a rifleman in a map corner was never found. The squares are now 4 cells,
  seen once all their open ground is in view, and only ground the searchers can drive to counts.
- **A beaten AI surrenders** (every skirmish level): with no Construction Yard, no MCV and no factory it can pay for
  (a refinery or $1,000; a helipad or airfield alone doesn't count), its army goes for the enemy, and once that is worth
  less than $1,200 it concedes (`resign.ts`), never while a teammate of its side still plays. What kept a beaten
  Recruit or Easy AI alive against the newcomer after 30 minutes (version 5, `--probe ai`): no structure at all, and a
  helicopter, a MiG or an Ore Truck somewhere on the map.

Against the newcomer and novice stand-ins (the same 240-game batches as above):

| | Recruit vs newcomer | Recruit vs novice | Easy vs newcomer | Easy vs novice |
|---|---|---|---|---|
| Games the human had won by minute 25, version 5 → 6 | 60% → **87%** | 38% → 90% | 29% → **60%** | 23% → 68% |
| Still undecided at 30 minutes | 33% → **6%** | 54% → 6% | 45% → 15% | 70% → 20% |
| Still running at 45 minutes | 25% → 5% | 48% → 4% | 30% → 5% | 60% → 7% |
| The human's wins: median length | 13 → 11 min | 21 → 18 min | 19 → 14 min | 22 → 19 min |
| The AI's wins | 9% → 9% | 2% → 2% | 31% → 33% | 7% → 8% |

**A beaten player's last units** (`endgame.ts`, 16 games a cell: the AI against the casual stand-in, who at minute 15 is
reduced to two units, an Ore Truck and his farthest fighter, hiding in the map's far corners):

| | Normal | Hard | Brutal |
|---|---|---|---|
| Classic: not found in 30 minutes, version 5 → 6 | 31% → **0%** | 40% → **6%** | 19% → **0%** |
| Classic: found within 10 minutes | 25% → 67% | 27% → 69% | 50% → 80% |
| Commander: not found in 30 minutes | 13% → 0% | 19% → 0% | 0% → 0% |
| Commander: found within 10 minutes | 38% → 100% | 69% → 94% | 87% → 100% |

(Recruit and Easy rarely get to crush the casual player by minute 15, so their cells are a handful of games.) The one
Classic Hard miss left: the crush removes his structures unseen, and the Classic commander waits out its five-minute hold
before attacking structures it still believes are there; in a real match it sees them fall.

### Classic AI-vs-AI on the curated maps

`run.ts --mode faction --maps curated --diff normal,hard --games 48`, two sets of seeds (192 games):

| Curated maps, Classic, Normal and Hard | Timeouts | Allied share (timeouts by material) |
|---|---|---|
| Version 5 (96 games) | 57% | 56% [46–66] |
| Version 6 | **44% [37–51]** | 62% [55–69] |
| (experiments, 96 games each:) thrift and the 13:00 first wave alone | 49% | 69% |
| … + artillery sieges (two seed sets) | 52% | 60% |
| … + artillery sieges + the long-war risk from 25 minutes (two seed sets) | 47% | 62% |
| Without thrift | 43% | 62% |
| Hold the first wave for the Allied commander only | 45% | 66% (and Hard against the casual player down to 49%) |

What remains (`run.ts --probe ai`): of the 84 timeouts, 35 are lopsided (the leader at 1.5 times the trailer's material
or more), and in nearly all of them the leader's waves go in and fall back from a Tesla Coil or turret base it can't
break; nobody is left searching any more. The Allied share drifted up because the 13:00 first wave takes away the Soviet
commander's early armour push; the V2 sieges give some of it back.

### Team play

**Recruit and Easy allies play support** (`AIController.supportPoint`): with a human teammate they send no waves of
their own (they still join his pushes), and their army waits a third of the way from their base towards his. A Recruit
ally used to spend its few units on its own waves and had none left, or too far away, when his base was hit; teammates'
bases are 70-odd cells apart on a 96×96 map. The newcomer stand-in with an AI teammate in a 2v2 against two AIs of the
same level (`teams.ts --mode 2v2 --diff recruit,easy --vs newcomer --games 32`), version 5 → 6:

| | Recruit ally (Commander / Classic) | Easy ally (Commander / Classic) |
|---|---|---|
| Attacks on the human's base: help arrived within 150 s | 25% → 43% (of 16 → 7) / 14% → 44% (7 → 9) | 53% → **74%** (72 → 65) / 52% → **72%** (71 → 65) |
| Help sent | 50% → 43% / 29% → 44% | 78% → 82% / 70% → 80% |
| Ally's army idle at home | 22% → 0% / 9% → 0% | 12% → 3% / 8% → 0% |
| Human team wins | 91% → 94% / 94% → 94% | 34% → 50% / 44% → 41% |

The team's results move within the noise: an ally at Recruit or Easy is a better-placed helper, not a stronger one.
From Normal up, help now outweighs the attackers (the review fix below); against two Normal AIs (`--enemy normal`) a
Normal ally sent help to 74% of the attacks on the human's base (53–57% in version 5).

Everything else in `teams.ts --games 16` (all modes, every AI at the level) stays where version 5 left it: 2v2 help sent
to 63–75% of the attacks on the human's base from Normal up (53–72% in version 5); navies unchanged (no ships at Recruit, 7–8.5 a side
at Hard and Brutal). In free-for-alls the low levels' waves at the human read 35–44% (29–35% in version 5) because more
of the AIs are gone by minute 45 (2.1–2.3 of 3, was 1.1–1.6: they now hunt down each other's last units), and the
survivors have only the human left to attack; the share comes out the same with surrender switched off, and the version-5
tie-break that spreads the first scouts round the map is unchanged.

### Code review fixes (in this round's AI review)

- An AI teammate's "push with the human" could start a wave of one unit, counted as a broken wave on the next think and
  sent home: 17 one-unit waves by minute 15, each raising the size of its next real wave. Three units at least now, and
  a push the human leads doesn't raise it.
- Help for a human teammate's base stopped at half the free army whatever it was worth; from Normal up it now sends
  enough to outweigh the attackers (Recruit and Easy: half, a modest helper).
- AI bases could box their own Ore Truck in (a power plant below the refinery's dock and a turret on either side):
  the 3×3 round each refinery dock and war-factory exit now takes no structure, and a new refinery or war factory goes
  only where its own lane is open.
- An MCV that couldn't deploy where it stood spiralled round its start for the whole match; it now drives to the nearest
  spot where the yard fits. A damaged tank on a broke AI's Service Depot pad waited for ever (production took every
  credit first): the AI keeps $150 back while a vehicle waits there.

### Still open

- **Classic Hard on the 96×96 menu default** against the casual stand-in: 38–47% depending on the seeds (27% in version 5),
  against 55–62% on the Quick Battle rolls; pooled, Classic Hard is 50%, ten points under the 60% aimed for. The AI still loses about six Ore Trucks a game (the casual player two to three),
  most of them on mid-map fields his columns cross; making trucks flee a column seen nearby did not change that.
- **Curated-map AI-vs-AI timeouts** are 44%, above the 35% aimed for, and the Allied share is 62%, just above 40–60%:
  the leader can't break a fortified base late in a match on mined-out maps.
- Seed sets move Classic Hard by ten points (53–63% for the same version on two sets); differences under about ten
  points between single 120-game batches here are noise.

## Where players meet the AI (simulation version 5)

The user's words: *"the AI is hard even on easy, I can't win"*, and then *"improve the gameplay on all modes for all
levels"*. The UI bot of the test lab (tools/e2e), playing through the real interface the way a first-time player does
(infantry waves, no defences), lost both of its Recruit Quick Battles; the Recruit AI had about 36 units and flame
towers by minute 7.

The stand-ins are described under *The stand-ins* below; version 5 adds the **newcomer**, a first-time player.

### What the Recruit AI did (Quick Battle seed 77, version 4)

`tools/selfplay/trace.ts` replays a match exactly as the game sets it up. On the bot's setup (`--autostart 77`: 96×96,
Commander rules, Recruit) the Recruit AI had spent $8,000 of its $10,000 by minute 3: 22 units worth $4,110 (15
riflemen, 5 rocket soldiers, a grenadier and its starting tank, exactly its $4,000 army cap) and its one flame tower.
From then on the army cap stopped units, so the money went into structures: by minute 7 two war factories, a radar, a
kennel, an airfield, a helipad, a service depot and two advanced power plants. The Quick Battle roll for seed 77 (112×112
desert, Air Marshal, Night Ops) did the same, plus three airfields and two helipads from the personality's build
order, and aircraft that the army cap did not count.

What applied and what did not:

| | |
|---|---|
| Applied | the $4,000 army cap (by value: cheap riflemen made it 20+ units), one defence (rebuilt when lost: two flame towers placed in the match), one refinery and two trucks, build speed 0.5 and income 0.7, no battlefield-event money (none earned), dynamic difficulty in the Quick Battle roll (it eased off, to level −3 by minute 3) |
| Did not apply | nothing limited infantry before the war factory or how fast the starting $10,000 went; aircraft and ships were outside the army cap; the personality's build order added airfields, helipads and a second war factory; nothing limited the number of structures |
| Mutators, rivals, events, Quick Battle extras | no effect on seed 77 (Night Ops is a look), and a rival is capped at the commander's level; but Quick Battle's newcomer pool included Credits Rain, which pays the AI and the player alike and is spent only by the AI (see below) |

What killed the newcomer's units in the AI's wins (the newcomer stand-in, 240 games): heavy tanks ($11,500 a game),
riflemen and rocket soldiers ($10,600), the flame tower ($4,300), V2 rockets ($3,600) and Mammoth Tanks ($2,400). The
Soviet Recruit beat an Allied newcomer in 68% of the games, the Allied Recruit a Soviet newcomer in 4%. The bot's waves
that "stalled mid-map" were a unit-behaviour matter (fixed in the same round: units return fire and retry blocked
moves) and an interface one (an attack-move click on a structure used to issue a plain attack).

### The levels against the stand-ins

`tools/selfplay/levels.ts`, 60 games a cell, version 4 against version 5 (this round, with the unit-behaviour fixes).
*Quick Battle*: a roll per game (generated 80–112 maps with water or a curated two-player map, climate, a personality or,
in 35% of the games, a rival with a newcomer's counter-plan, one newcomer-safe mutator below Normal and one or two from
Normal up, battlefield events, dynamic difficulty on below Normal); Quick Battle is Commander rules, and the same rolls
were also played under Classic rules. *Custom*: the skirmish menu's defaults (96×96, water 0.5, $10,000, light start,
events, balanced personality, dynamic difficulty at its default). Factions alternate; a game still running at 45 minutes
goes to the side ahead on material. Pooled over both conditions (240 games a row, 120 per ruleset):

| Level vs stand-in | Target | Version 4 | Version 5 | Classic (v4 → v5) | Commander (v4 → v5) | Human's wins, median length (v5) |
|---|---|---|---|---|---|---|
| Recruit vs newcomer | ≤ 15% | 36% [30–42] | **9% [6–13]** | 36% → 8% | 36% → 10% | 16 min |
| Recruit vs novice | ≤ 5% | 1% [0–3] | 3% [1–5] | 0% → 3% | 2% → 3% | 33 min |
| Easy vs newcomer | ≤ 40% | 77% [71–82] | **31% [26–37]** | 73% → 28% | 82% → 34% | 30 min |
| Easy vs novice | ≤ 20% | 16% [12–21] | 7% [4–11] | 13% → 12% | 18% → 3% | 45 min |
| Easy vs casual | ≤ 10% | 0% [0–2] | 0% [0–2] | 0% → 0% | 0% → 0% | 36 min |
| Normal vs casual (with its new economy, below) | 40–60% | 39% [33–45] | **47% [41–53]** | 33% → 46% | 45% → 48% | — |
| Hard vs casual | ≥ 65% | 63% [56–68] | 55% [49–62] | 46% → 38% | 79% → 73% | — |
| Hard vs experienced | 40–60% | 57% [50–63] | 60% [53–66] | 58% → 68% | 55% → 52% | — |
| Brutal vs experienced | ≥ 80% | 93% [89–96] | 93% [88–95] | 94% → 92% | 93% → 93% | — |

The same match-ups with the version-4 AI on this round's units (120 games a ruleset) put Recruit and Easy against the
newcomer at 33% and 78%: the drop to 9% and 31% is the AI's. Hard against the experienced stand-in in Classic rose from
58% to 68% [59–75], above the 40–60% aimed for, while Hard against the casual player in Classic is 38%: Classic Hard
handles AI-like play better than it did and the tank-massing casual player no better (*Still open*, below).

By condition (version 4 → 5, 60 games each): Recruit vs newcomer, Quick Battle 38% → 13% (Commander) and 33% → 8%
(Classic rules), custom 33% → 7% and 38% → 7%; Easy vs newcomer, Quick Battle 75% → 32% and 72% → 25%, custom 88% → 37%
and 73% → 32%. Hard against the casual player in Classic is 50% on the Quick Battle rolls and 27% on the 96×96 custom
default (38% in version 4), the gap version 4 left open (*Still open* below).

Signs of life (version 5; games still running at minute 15): the Recruit AI scouted by minute 5 in every game, sent
its first wave at 10:00 (median; was 15:00) and had a wave out by minute 15 in 100% of the games against the novice
(85% before) and 73% against the newcomer (51%: the newcomer keeps its army busy at home); Easy at 9:00 (was 12:00),
100% and 80%; their units reached the human's base by minute 15 in 99–100% of the games against the novice and 65%
(Recruit) / 100% (Easy) against the newcomer. A newcomer's wins against Recruit take 16 minutes (median).

**Dynamic difficulty** (on by default below Normal) stayed assist-only: in 1,200 Recruit and Easy games it never pushed
harder, and it eased off in 357 of them (down to level −4).

### What changed (Recruit and Easy use less)

Every one of these is something the easy levels *use less* of, visible on the battlefield; none is a hidden penalty.
Each step was measured against the newcomer stand-in (40 games a cell: Quick Battle and the menu defaults, both rulesets,
160 games a level). The later steps ran on the tree with the round's unit-behaviour fixes (return fire, move retries).

| Step | Recruit vs newcomer | Easy vs newcomer |
|---|---|---|
| Version 4 | 36% | 77% |
| A: the army grows over the match (Recruit $1,200 + $250 a minute, Easy $1,500 + $300, aircraft and ships counted), 6 / 8 riflemen before the war factory, one of each factory | 56% (stronger: the money went into tanks and structures) | 88% |
| A + earlier, smaller first waves (10:00 for $1,000 / 9:00 for $1,800) | 49% | 81% |
| A + no ground defence before 10:00 / 6:00 | 28% | 87% |
| A + both + no artillery, V2s, Mammoths or specials, 3 / 6 combat vehicles at most | 23% | 77% |
| … + the army waits behind the yard, 10 / 13 structures at most, no decoys | 16% | 74% |
| … + Easy: one defence, not before 10:00 (was two from 6:00), 4 vehicles, wave cap $3,000, army cap $6,000 | 16% | 34% |
| … + Recruit: 2 combat vehicles at most (version 5 as shipped) | 11% | 34% |

Tried and left out: smaller army caps (Recruit $3,000: 12%, but more games running to the time limit), the army waiting
in front of the yard vs behind it (no difference within the noise), sparing the human's construction yard until last
(no difference), dropping the riflemen limit before the war factory (no difference: it stays, as the cure for the
reported crowd of riflemen).

Also in version 5:

- **Credits Rain** left Quick Battle's newcomer-safe pool (see *Looking for AI advantages*).
- **Short of money** ($2,500 with Lean Times, or a refinery lost with an empty bank): the AI builds the power plant the
  refinery needs and then the refinery, before anything else. It used to build two power plants and a barracks, and
  the refinery then waited half-paid for ever with no income to finish it (the daily challenge's Lean Times AI).
- **Free-for-alls**: with several enemy starts equally far away (a symmetric four-player map), the low levels used to
  scout, and then attack, the first seat in the list: the human's. Ties now go round the map one way, so each AI
  looks at a different neighbour.
- **Navies**: Recruit fields no ships, and now builds no shipyard either ($650 it never used).

### Classic: finishing the game

Classic AI-vs-AI games on the curated two-player maps (normal and hard, both sides the same AI, 96 games,
`run.ts --mode faction --maps curated`): 77% ran to the 45-minute limit in version 4, and 93% on this round's tree
before these changes (the units now return fire and retry blocked moves, which made sieges costlier still). Half of
the timeouts were lopsided (the leader at twice the trailer's material or more): the leader either had no target left
that it knew of (the enemy's last structures out of sight), or turned every wave back at a Tesla Coil base it could not
break. What the Classic commander (normal and up) does now, judgement only, rules untouched:

- **Hunting** (`AIIntel.huntPoint`, every skirmish AI): with no enemy structure, start or unit left that it knows of
  while an enemy is still in the game, its waves search the map, the square it has gone longest without seeing first.
  The waves used to sit at home until the time limit.
- **Sieges** (`AITuning.proSiege` 2): a wave stopped by defences rather than by an army, while the commander is clearly
  ahead (its army worth 1.5 times its estimate of the enemy's), holds at its staging point outside their reach and
  calls up the rest of the army, then goes in again once it outweighs what stopped it, twice at most, instead of
  going home. While clearly ahead it also counts known defences at 1.5 times their price instead of 2 when it weighs
  what a wave faces (`proTowerW`).
- **Power** (`proPower`): the power plants a Tesla Coil base can't spare (by what it has seen of his plants and
  consumers) come first among wave targets, and a coil it sees standing dark counts for nothing. In Red Alert a coil
  base falls with its power.
- **A lean first 15 minutes** (`proLean`): the tech centre, a third refinery and a second Tesla Coil wait for money or
  an army edge, like the other extras.

Ungated, the sieges and the lighter tower weight took about 10 points off Normal and Hard against the casual stand-in (an
army that leaves home to besiege leaves its own base bare against a commander who masses tanks and counter-attacks),
which is why they wait for a clear lead.

| Curated maps, Classic, normal and hard (96 games) | Timeouts | Allied share (timeouts by material) | Allied share of decided games |
|---|---|---|---|
| Version 4 | 77% | 70% [60–78] | 50% (11 of 22) |
| This round's units, version-4 AI | 93% | 71% [61–79] | 71% (5 of 7) |
| + sieges and the lighter tower weight, ungated | 68% | 60% [50–70] | 65% (20 of 31) |
| + lean build, power play, hunting; sieges gated (version 5, with Normal's economy below) | **57%** | **56% [46–66]** | 66% (27 of 41) |

The Allied share is back inside 40–60%, but timeouts stay far above the 35% aimed for: in half of the remaining ones
the leader is 1.5 times ahead on material or more (a quarter 2.3 times), the rest are even games in which two fortified
commanders trade waves. *Still open* (44% in version 6: *Finishing matches and Classic Hard*, above).

**Normal** now builds at 1.0 and earns 1.05 (was 0.95 / 1.0): on this round's tree the unit-behaviour fixes had taken
Normal against the casual stand-in from 33% to 27% in Classic and from 45% to 38% under Commander rules (version-4 AI
on the new units, 120 games each); with the 5% it is 46% [37–55] in Classic and 48% [40–57] under Commander rules
(custom 40% / 52%, Quick Battle 52% / 45%), inside 40–60% in both. Hard (1.05 / 1.05) stays a step above it.

**Hard against the casual stand-in in Classic** stays the gap version 4 left: 27% on the 96×96 custom default and 50%
on the Quick Battle rolls (38% / 53% before). The casual player has twice the Classic AI's army at minute 10 and
destroys its Ore Trucks and refineries at home: the AI harvests $48,000 a game to his $65,000 and builds 12 tanks to
his 45. Raising Classic Hard's economy to 1.15 (tried) brings the Quick Battle rolls to 68% but the custom default
only to 30%, and lifts Hard over the experienced stand-in to 75–88%: the AI's judgement against a tank-massing,
counter-attacking player is what is missing, not money. *Still open* (version 6: 50% [44–57], see *Finishing matches
and Classic Hard*, above).

### Team play, free-for-alls and navies

`tools/selfplay/teams.ts`, 16 games a cell (both rulesets), the casual stand-in as the human; version 4 against version
5 (both with the round's team-aware start positions, src/sim/starts.ts).

**2v2 with an AI teammate** (the lobby's AI seats; every AI at the level). AI teammates had no notion of a human
teammate: they never came to his base when it was attacked, and the easy levels sat at home a third to half of the
time. Now an AI teammate (`src/sim/ai-team.ts`, only with a human on its team) sends help when the human's base is
attacked (after the level's reaction delay, with at least half its free army or enough to outweigh the attackers),
joins the human's pushes (when his army is at an enemy base, its idle army goes for the same base, wave caps still
apply), and keeps its Ore Trucks off the fields by his refineries while another field has ore.

| Level (Commander / Classic) | Help sent to the human's base, v4 → v5 | Pushes joined | Teammate idle at home | Human team wins, v4 → v5 |
|---|---|---|---|---|
| Recruit | 0% → 0% / 0% → 0% (1 and 8 attacks) | 29% → 53% / 13% → 60% | 37% → 17% / 50% → 18% | 100% → 100% |
| Easy | 0% → 20% / 0% → 33% | 41% → 61% / 38% → 66% | 22% → 12% / 38% → 12% | 100% → 100% |
| Normal | 0% → 74% / 0% → 48% | 49% → 57% / 25% → 38% | 5% → 1% / 13% → 5% | 63% → 75% / 44% → 69% |
| Hard | 0% → 64% / 0% → 72% | 27% → 33% / 29% → 36% | 6% → 2% / 12% → 3% | 31% → 13% / 44% → 63% |
| Brutal | 0% → 61% / 0% → 71% | 29% → 36% / 23% → 46% | 3% → 1% / 10% → 2% | 6% → 6% / 13% → 0% |

The help arrives within 150 s in 16–38% of the attacks (median 20–90 s): most attacks are over by then, beaten by the
human's own defences. The AI teammates never mined by the human's refinery in either version (0–2% of their harvesting).

**Free-for-all** (the human and three AIs): version 4's Recruit and Easy aimed 51–67% of their waves at the human
(a third would be even-handed): their only scout went to the nearest unexplored start, and on a symmetric map the
first of several equally near starts in the list, the human's seat. Ties now go round the map one way: 29–35% at
Recruit and Easy; Normal and up 15–25% (21–30% before).

**Navies** (two AIs of the level on a generated sea map; `--map archipelago` gives the same picture): ships built per
side (median) 0 / 1 / 5 / 6–9 / 8–9 from Recruit to Brutal, sinking ships and shelling the shore in proportion. Recruit
fields no ships by design and now builds no shipyard either (it built one in every game before). Two Recruit or two
Easy AIs on a sea map rarely finish each other inside 45 minutes.

## Difficulty levels (simulation version 3)

The user report that started this: *"the AI seems to be hard even on easy, I can't win. They collect lots of money"*.
It was right. Under Commander rules (the skirmish default) Easy beat the novice stand-in in **every** game and the
casual one in 85%, and harvested 3.7 times as much as the novice ($3,139 a minute against $857).

### The stand-ins (`tools/selfplay/standin.ts`, frozen: don't tune them to the AI)

They play through the same commands as the UI, as human players: no AI slot, so none of the AI's event, derrick or
mercenary helpers work for them. They act every few seconds of "attention", with a seeded RNG.

| Stand-in | Plays like |
|---|---|
| **Newcomer** (version 5) | A first-time player, after the UI bot's first naive player (tools/e2e) and how new players play their first skirmishes: the opening the first launch teaches (power, refinery, barracks, power, war factory), built slowly (30 s between structures); one refinery and its free Ore Truck; mostly riflemen with a few light vehicles (light tanks and jeeps, heavy tanks for the Soviets), queued four at a time every 12 s, so money often sits idle. No defences, repairs, commander powers or harvester care. From minute 5 every group at home worth $700 or more goes across the map on an attack-move as soon as it gathers (one every 75 s at most), and no group ever comes back; a raid on the base is answered after 25 s with half the idle units at home. |
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
(68% timeouts, Allies 71% of the decided games). Version 5 takes it to 57% timeouts and a 56% Allied share (*Classic:
finishing the game*, above); still open.

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
| Build speed / ore income | 0.5 / 0.7 | 0.6 / 0.75 (was 0.65 / 0.9) | 1.0 / 1.05 (version 5; was 0.95 / 1.0) | 1.05 / 1.05 (was 1.15 / 1.15) | 1.4 / 1.35 |
| Refineries / Ore Trucks at most | 1 / 2 | 2 / 3 | 3 / 6 | — | — |
| Expansions / mining outposts | none | none | 1 / 1 | 2 / 2 | 3 / any |
| Oil derricks, battlefield events | no / no | no / no | yes / 60% of events | yes / 80% | yes / all |
| Tech tiers (Commander) | Tier 1 | Tier 2, late (×3 the timing) | all, ×1.3 later | all, ×1.1 | all |
| Research | none | one Level I line, no harvesting lines | four levels in all | any | any |
| Upgrades | none | Turbines only | 2 Processors at most, no Purifier, Smelter or Logistics Centre | 3 Processors | any |
| Doctrine | none | none | yes | yes | yes |
| Commander powers | none | Field Repair only, 2 min apart | all but Tesla Storm and Sabotage, 45 s apart | all, 30 s apart | all |
| First wave / its value / growth | 10:00 / $1,000 / $300 (was 15:00 / $1,800 / $400) | 9:00 / $1,800 / $700 (was 12:00 / $2,500) | 7:00 / $3,500 / $1,800 | 5:00 / $3,500 / $2,000 | 3:30 / $3,500 / $2,200 |
| Wave and army caps | $3,000 / $4,000 | $3,000 / $6,000 (was $6,000 / $8,000) | $12,000 / $30,000 | — | — |
| Army cap at the start, growth a minute (aircraft and ships count) | $1,200, +$250 | $1,500, +$300 | — | — | — |
| Combat vehicles at most; units it never builds | 2; artillery, V2s, Mammoths, Tesla and Chrono tanks, specials | 4; the same | — | — | — |
| Riflemen before the war factory | 6 | 8 | — | — | — |
| Structures (power aside); factories | 10; one barracks, war factory, airfield, helipad; no kennel, decoys or gap generator | 12; the same | — | — | — |
| Defences, bunkers | 1, none, not before 10:00 (was 1 from the start) | 1, none, not before 10:00 (was 2, +1 after 15 min); one Tesla Coil at most | 3 (+2), 2 | 4 (+2), 3 | 5 (+2), 3 |
| Where the army waits between waves | 3 cells behind the yard | 3 cells behind the yard | 5 cells in front | 5 cells in front | 5 cells in front |
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
  so; Quick Battle never rolls it, and below Normal rolls only newcomer-safe mutators. *Credits Rain* left that pool
  in version 5: it pays everyone the same $400 every 30 seconds, but the AI spends it at once and a new player banks
  it (Easy won 52% of its Quick Battles against the newcomer stand-in with it, 31% without).
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
