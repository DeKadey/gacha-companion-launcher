const DEFAULT_RUNS = 100_000;

function getPullRate(baseRate, softPity, hardPity, currentPity) {
  if (currentPity < softPity) return baseRate;
  if (currentPity >= hardPity) return 1;
  const range = hardPity - softPity;
  const progress = currentPity - softPity;
  return baseRate + (1 - baseRate) * (progress / range);
}

function simulateOneFeatured(banner, startPity = 0, startGuaranteed = false) {
  const { baseRate, softPity, hardPity, has5050, featuredChance = 0.5, guaranteeCarryOver } = banner;
  let pity = startPity;
  let guaranteed = startGuaranteed;
  let pulls = 0;

  while (true) {
    pulls++;
    pity++;
    const rate = getPullRate(baseRate, softPity, hardPity, pity);
    if (Math.random() < rate || pity >= hardPity) {
      pity = 0;
      if (!has5050) return pulls;
      if (guaranteed) { guaranteed = false; return pulls; }
      if (Math.random() < featuredChance) {
        if (guaranteeCarryOver) guaranteed = false;
        return pulls;
      } else {
        if (guaranteeCarryOver) guaranteed = true;
        continue;
      }
    }
  }
}

export function pullsToCurrency(pulls, costPerPull) {
  return pulls * costPerPull;
}

// Simulate total pulls needed to hit charCopies on charBanner AND weaponCopies on weaponBanner.
// Either copies count can be 0 to skip that banner.
export function simulateCombined({
  charBanner,
  weaponBanner,
  charCopies = 0,
  weaponCopies = 0,
  startCharPity = 0,
  startCharGuaranteed = false,
  startWeaponPity = 0,
  startWeaponGuaranteed = false,
  runs = DEFAULT_RUNS,
}) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    let total = 0;
    for (let c = 0; c < charCopies; c++) {
      total += simulateOneFeatured(charBanner, c === 0 ? startCharPity : 0, c === 0 ? startCharGuaranteed : false);
    }
    for (let w = 0; w < weaponCopies; w++) {
      total += simulateOneFeatured(weaponBanner, w === 0 ? startWeaponPity : 0, w === 0 ? startWeaponGuaranteed : false);
    }
    results.push(total);
  }
  results.sort((a, b) => a - b);
  return results;
}

// Given a sorted results array from simulateCombined, return the pulls at or below `probability` (0–1).
export function pullsAtProbability(sortedResults, probability) {
  const idx = Math.min(Math.floor(sortedResults.length * probability), sortedResults.length - 1);
  return sortedResults[idx];
}
