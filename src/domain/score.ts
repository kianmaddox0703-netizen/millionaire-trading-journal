/**
 * Setup score (0–10) from user-configurable factor weights.
 *   score = 10 × Σ(weight_f × rating_f / 2) ÷ Σ(weight_f)     rating ∈ {0, 1, 2}
 * Only factors that were rated count, so an unrated factor doesn't drag the score down.
 * This measures how complete the setup was by YOUR definition, not a probability of winning.
 */
export interface Factor { key: string; label: string; weight: number }

export function setupScore(factors: Factor[], ratings: Record<string, number | null | undefined>): number | null {
  let num = 0, den = 0;
  for (const f of factors) {
    const r = ratings[f.key];
    if (r === null || r === undefined || f.weight <= 0) continue;
    num += f.weight * (Math.max(0, Math.min(2, r)) / 2);
    den += f.weight;
  }
  return den > 0 ? (10 * num) / den : null;
}
