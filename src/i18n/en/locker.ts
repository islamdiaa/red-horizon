/** The Locker (src/ui/locker.ts): cosmetic tabs, cards, requirements, equip / claim. Item names: game data cosmetic.*. */
import { strings } from '../core';

export default strings('locker', {
  title: 'Locker',
  kicker: 'Locker · {rank}',
  commendations: 'Commendations',
  status: {
    equipped: 'Equipped',
    new: 'New',
    owned: 'Owned',
  },
  equip: 'Equip',
  equipped: 'Equipped',
  claim: 'Claim · {n}',
  listen: 'Listen',
  req: {
    standard: 'Standard issue.',
    claimed: 'Claimed with Commendations.',
    met: 'Requirement met: {how}.',
  },
  note: {
    noSound: 'Sound is not available yet: click anywhere in the game first, or check the volume settings.',
    claimed: 'Claimed and equipped.',
    fair: "Cosmetics never change the battle: paint applies to your own units' look only, and Commendations are earned from contracts, never bought.",
  },
});
