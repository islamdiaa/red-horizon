/**
 * The doctrine picker of the skirmish setup (src/ui/doctrine-picker.ts). Doctrine names, blurbs, bonuses and
 * drawbacks come from the game data (dt() table doctrine), rank names from the rank table.
 */
import { strings } from '../core';

export default strings('doctrine', {
  none: 'No doctrine',
  // the selector's second line when no doctrine is chosen
  noneSub: 'Standard rules for your side',
  noneCard: 'Plain rules for your side: no bonus, no drawback.',
  aria: 'Choose a doctrine',
  kicker: '{side, select, soviet {Soviet doctrine} other {Allied doctrine}}',
  title: 'Choose how you fight',
  sub: 'Two bonuses and one drawback for the whole match. Commander rules only; your opponents pick their own.',
  // a locked doctrine card: the commander rank (number and name) that opens it
  lock: 'Commander rank {n}: {rank}',
  lockTip: 'Reach commander rank {n} ({rank}) to unlock',
});
