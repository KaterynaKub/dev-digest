/** Confidence thresholds for the bar colour. Mirrors the ConfidenceNum
 *  primitive's own scale so a candidate reads the same wherever it appears. */
export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MED = 0.65;

export function confidenceColor(value: number): string {
  if (value >= CONFIDENCE_HIGH) return "var(--ok, #16a34a)";
  if (value >= CONFIDENCE_MED) return "var(--warn, #d97706)";
  return "var(--text-muted)";
}
