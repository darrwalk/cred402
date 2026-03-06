export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'U';

export interface GradeInfo {
  grade: Grade;
  label: string;
}

/**
 * Grade bands per spec:
 * A (90–100): Excellent
 * B (75–89):  Good
 * C (55–74):  Fair
 * D (30–54):  Poor
 * F (0–29):   Untrustworthy
 * U:          Unscored (insufficient data)
 */
export function getGrade(score: number): GradeInfo {
  if (score >= 90) return { grade: 'A', label: 'Excellent' };
  if (score >= 75) return { grade: 'B', label: 'Good' };
  if (score >= 55) return { grade: 'C', label: 'Fair' };
  if (score >= 30) return { grade: 'D', label: 'Poor' };
  return { grade: 'F', label: 'Untrustworthy' };
}

export function getUnscored(): GradeInfo {
  return { grade: 'U', label: 'Unscored' };
}
