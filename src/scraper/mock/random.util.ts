export function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random Date between `hoursAgoMax` and `hoursAgoMin` hours before now. */
export function randomPastDate(hoursAgoMin: number, hoursAgoMax: number): Date {
  const hoursAgo = randomInt(hoursAgoMin, hoursAgoMax);
  const minutesJitter = randomInt(0, 59);
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000 - minutesJitter * 60 * 1000);
}
