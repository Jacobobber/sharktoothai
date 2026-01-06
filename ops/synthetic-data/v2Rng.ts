export type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(values: T[]) => T;
  shuffle: <T>(values: T[]) => T[];
};

const hashSeed = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

export const createRng = (seed: string | number): Rng => {
  const base = typeof seed === "number" ? seed : hashSeed(seed);
  const next = mulberry32(base);
  return {
    next,
    int: (min: number, max: number) => {
      const clampedMin = Math.ceil(min);
      const clampedMax = Math.floor(max);
      return Math.floor(next() * (clampedMax - clampedMin + 1)) + clampedMin;
    },
    pick: <T>(values: T[]) => {
      if (!values.length) throw new Error("pick() called with empty array");
      return values[Math.floor(next() * values.length)];
    },
    shuffle: <T>(values: T[]) => {
      const copy = [...values];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }
  };
};
