export type FitmentReplyOutcome = 'SUCCESS' | 'FAILED' | 'UNKNOWN';

/**
 * VAHAN's recordFitment answers with free text. Known success and failure phrasings are recognised;
 * anything else is UNKNOWN and is retried, then moved to the manual queue.
 */
export function parseFitmentReply(text: string | null | undefined): FitmentReplyOutcome {
  const t = (text ?? '').trim();
  if (!t) return 'UNKNOWN';
  if (/(updated|saved|recorded)\s+successfully|^success\b/i.test(t)) return 'SUCCESS';
  if (/not\s+found|invalid|mismatch|already\s+(fitted|updated)|does\s+not\s+match/i.test(t)) return 'FAILED';
  return 'UNKNOWN';
}
