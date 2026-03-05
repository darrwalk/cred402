export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | 'U';

export interface GradeInfo {
  grade: Grade;
  label: string;
}

export function getGrade(score: number): GradeInfo {
  if (score >= 90) return { grade: 'A', label: 'Excellent' };
  if (score >= 75) return { grade: 'B', label: 'Good' };
  if (score >= 55) return { grade: 'C', label: 'Fair' };
  if (score >= 35) return { grade: 'D', label: 'Poor' };
  return { grade: 'F', label: 'High Risk' };
}

export function getUnscored(): GradeInfo {
  return { grade: 'U', label: 'Unscored' };
}
