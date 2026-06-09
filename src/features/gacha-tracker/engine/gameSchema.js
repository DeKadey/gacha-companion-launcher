export const EMPTY_GAME_CONFIG = {
  id: '',
  name: '',
  color: '#7c6af7',
  iconPath: '',
  deleted: false,
  usesAppColor: true,
  pullItemName: '',
  charCopyLabel: 'Constellation',
  weaponCopyLabel: 'Refinement',

  charBanner: {
    baseRate: 0.006,
    softPity: 74,
    hardPity: 90,
    has5050: true,
    featuredChance: 0.5,
    guaranteeCarryOver: true,
    costPerPull: 160,
    currencyName: '',
  },

  weaponBanner: {
    baseRate: 0.007,
    softPity: 63,
    hardPity: 80,
    has5050: true,
    featuredChance: 0.75,
    guaranteeCarryOver: true,
    costPerPull: 160,
    currencyName: '',
    specialMechanicId: 'none',
    specialMechanicConfig: {},
  },

  // Only active when linkedDatabase = 'genshin'
  chronicledBanner: {
    baseRate: 0.006,
    softPity: 74,
    hardPity: 90,
    has5050: true,
    featuredChance: 0.5,
    guaranteeCarryOver: false,
    costPerPull: 160,
    currencyName: '',
  },

  state: {
    currency: 0,
    pullItems: 0,
    charPity: 0,
    charGuaranteed: false,
    weaponPity: 0,
    weaponGuaranteed: false,
    chronicledPity: 0,
    chronicledGuaranteed: false,
    fatePoints: 0,
    history: [],
    wishList: [],
    pullLog: [],
  },
};

export function createGame(overrides = {}) {
  const id = crypto.randomUUID();
  return deepMerge(EMPTY_GAME_CONFIG, { ...overrides, id });
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}
