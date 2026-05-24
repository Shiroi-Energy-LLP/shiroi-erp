/**
 * LeadScoreBadge — visual indicator for C1 AI lead scores.
 *
 * Bands:
 *   0-30   gray   "0-30"
 *   31-60  yellow "31-60"
 *   61-85  green  "61-85"
 *   86-100 red    "HOT"  (bold)
 *
 * When score is null (not yet scored): shows a muted "—" placeholder.
 */

interface LeadScoreBadgeProps {
  score: number | null | undefined;
  /** Optional: show the numeric value alongside the HOT label */
  showNumber?: boolean;
  className?: string;
}

export function LeadScoreBadge({ score, showNumber = false, className }: LeadScoreBadgeProps) {
  if (score === null || score === undefined) {
    return (
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-n-400 ${className ?? ''}`}>
        —
      </span>
    );
  }

  if (score >= 86) {
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-red-100 text-red-700 border border-red-300 ${className ?? ''}`}
        title={`AI score: ${score}`}
      >
        {showNumber ? `HOT ${score}` : 'HOT'}
      </span>
    );
  }

  if (score >= 61) {
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 border border-green-300 ${className ?? ''}`}
        title={`AI score: ${score}`}
      >
        {score}
      </span>
    );
  }

  if (score >= 31) {
    return (
      <span
        className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 border border-yellow-300 ${className ?? ''}`}
        title={`AI score: ${score}`}
      >
        {score}
      </span>
    );
  }

  // 0-30
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-n-100 text-n-500 border border-n-200 ${className ?? ''}`}
      title={`AI score: ${score}`}
    >
      {score}
    </span>
  );
}
