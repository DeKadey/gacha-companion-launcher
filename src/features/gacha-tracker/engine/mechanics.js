export const SPECIAL_MECHANICS = [
  {
    id: 'epitomized_path',
    name: 'Epitomized Path',
    description:
      'Players choose a target weapon. Each non-target 5★ weapon earns 1 Fate Point. ' +
      'At the Fate Point threshold, the next 5★ is guaranteed to be the chosen weapon. ' +
      'Fate Points reset when the banner ends or the target is obtained.',
    fields: [
      {
        key: 'fatePointsNeeded',
        label: 'Fate Points needed for guarantee',
        type: 'number',
        default: 1,
        hint: 'Genshin Impact uses 1',
      },
    ],
  },
  {
    id: 'path_of_resonance',
    name: 'Path of Resonance',
    description:
      'Similar to Epitomized Path. Players designate a target weapon and accumulate resonance ' +
      'points toward a guarantee. Point threshold may differ per game.',
    fields: [
      {
        key: 'fatePointsNeeded',
        label: 'Points needed for guarantee',
        type: 'number',
        default: 2,
        hint: 'Check your game for the exact threshold',
      },
    ],
  },
  {
    id: 'none',
    name: 'None',
    description: 'No special mechanic — standard 75/25 with carry-over guarantee.',
    fields: [],
  },
];

