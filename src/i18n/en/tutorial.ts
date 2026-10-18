/**
 * Boot Camp, the interactive tutorial (src/missions/tutorial.ts). The mission script runs inside the simulation
 * (lockstep, saved), so it keeps emitting this English; the screens that show it (campaign screen, briefing,
 * objectives, radio, debrief) translate it with trSource().
 */
import { sourceStrings } from '../core';

export default sourceStrings('tutorial', {
  // mission title on the campaign screen
  title: 'Boot Camp',
  location: 'Training Ground Delta, England',
  date: 'March 1953',
  briefing: {
    intro: 'Before you take a command at the front, Sergeant Major Harlan will walk you through the basics on the training ground.',
    drills: 'Nine short drills: moving and fighting, building a base, earning money from ore, training troops, defending, and leading an assault. Each drill unlocks the next.',
    grading: 'Take your time. Nobody is grading the first one, except the Sergeant Major.',
  },
  // "Field notes" on the briefing screen
  tips: {
    select: 'Left-drag to box-select, right-click to move or attack.',
    scroll: 'Arrow keys, the screen edge or right-drag scroll the map; the mouse wheel zooms.',
    build: 'The build bar at the bottom (the sidebar on the right in the Classic layout) builds structures and trains units.',
  },
  // player names (scoreboard)
  player: {
    you: 'Training Company',
    enemy: 'Opposing Force',
  },
  // the drill instructor: rank and name (radio speaker)
  sergeant: 'Sgt. Major Harlan',
  debrief: {
    win: 'Not bad at all, Commander. You move, you build, you fight. The front is waiting. Try not to make me regret signing your papers.',
    lose: 'Everybody loses a drill once. Shake it off and run it again. That is what a training ground is for.',
  },
  objective: {
    move: 'Move your squad to the flashing beacon',
    fight: 'Destroy the enemy scouts',
    deploy: 'Deploy the MCV into a Construction Yard',
    power: 'Build a Power Plant',
    ore: 'Build an Ore Refinery',
    infantry: 'Build a Barracks and train 5 Riflemen',
    defend: 'Hold the base against the attack',
    armour: 'Build a War Factory and a Light Tank',
    assault: 'Destroy the enemy training camp',
  },
  // the Sergeant Major's radio lines, in drill order
  radio: {
    hello: 'Morning, Commander. Sergeant Major Harlan. Today you learn to run a battle. First things first: your squad. Drag a box around them with the left mouse button.',
    move: 'Now right-click near the flashing beacon to move them there. Scroll with the arrow keys or the screen edge, zoom with the wheel.',
    fight: 'Good. Enemy scouts up ahead. Select your squad and right-click one of them to attack. Your men pick the next target on their own.',
    deploy: 'Scouts down. Here comes your MCV, a base on wheels. Select it and press D, or click it a second time, to unpack the Construction Yard.',
    power: 'That is your Construction Yard. Everything else needs power. Click the Power Plant card in the build panel; when it reads READY, click the ground next to your yard to place it.',
    ore: 'Lights on. Now money. An Ore Refinery comes with a free Ore Truck that harvests the gold fields on its own. Gems are worth double.',
    infantry: 'Ore is flowing. Next, a Barracks. Once it stands, click the Rifleman card five times; Shift-click queues five at once.',
    defend: 'Heads up: the opposing force is sending a raid in about thirty seconds. Pillboxes are unlocked. Tip: select your riflemen and press Ctrl+1, then press 1 any time to call them back up.',
    raid: 'Here they come! Dogs in front: they kill infantry in one bite, so shoot them first.',
    armour: 'Raid repelled. Infantry alone will not crack a defended camp, so build a War Factory and roll out a Light Tank.',
    assault: 'There is their camp: barracks, two power plants, two pillboxes. Gather your army, press A, then click near the camp: an attack-move fights everything on the way.',
    counters: 'Rocket Soldiers make short work of armour; tanks and riflemen handle pillboxes. Medium Tanks are unlocked too.',
    done: 'Camp destroyed. That is the whole job, Commander: build, harvest, train, fight. Dismissed.',
  },
  // Battle Control, when the player has spent almost everything
  stipend: 'Training funds transferred: $1,200.',
  // mission failed: the reason shown on the debrief
  wipedOut: 'Your training company was wiped out.',
});
