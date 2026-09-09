/**
 * Dashboard activity model.
 *
 * The dashboard previously showed only totals, which answer "how much have I done"
 * but never "what should I do next". These helpers derive the three things that
 * actually change behaviour: recent throughput, applications that have gone quiet,
 * and a concrete next action.
 *
 * Pure functions with an injected `now` so the time-dependent behaviour is testable.
 */

export interface ApplicationRecord {
  status: string;
  created_at: string;
  updated_at?: string | null;
  applied_at?: string | null;
  job?: { company?: string | null; title?: string | null } | null;
}

export interface VelocityBucket {
  /** ISO date for the day, `YYYY-MM-DD`. */
  date: string;
  count: number;
}

export interface StaleApplication {
  label: string;
  status: string;
  days: number;
}

export interface NextAction {
  id: string;
  label: string;
  detail: string;
  href: string;
}

const DAY_MS = 86_400_000;

/** Applications are considered quiet after this long with no movement. */
export const STALE_AFTER_DAYS = 14;

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * A `YYYY-MM-DD` key in the viewer's own timezone.
 *
 * Deliberately not `toISOString()`: that returns a UTC date, which combined with a
 * local day boundary put an application into the wrong bucket for anyone not on UTC.
 * The chart describes the user's days, so the key must be local too.
 */
export function localDayKey(value: number): string {
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parse(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** When an application was actually sent, falling back to when it was created. */
function activityTime(record: ApplicationRecord): number | null {
  return parse(record.applied_at) ?? parse(record.created_at);
}

/**
 * Applications per day over the trailing window.
 *
 * Every day in the range is emitted, including empty ones — gaps are the signal worth
 * seeing, and a chart that silently omits them would misrepresent a quiet week as
 * steady activity.
 */
export function applicationVelocity(records: ApplicationRecord[], days = 30, now = Date.now()): VelocityBucket[] {
  const today = startOfDay(now);
  const buckets = new Map<string, number>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    buckets.set(localDayKey(today - offset * DAY_MS), 0);
  }
  for (const record of records) {
    if (!APPLIED_STATUSES.has(record.status)) continue;
    const time = activityTime(record);
    if (time === null) continue;
    const key = localDayKey(time);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

/** Statuses that represent a submitted application rather than a saved lead. */
const APPLIED_STATUSES = new Set(["applied", "assessment", "interview", "offer"]);

/** Statuses still awaiting a reply. Closed outcomes can never be "stale". */
const AWAITING_STATUSES = new Set(["applied", "assessment", "interview"]);

/**
 * Applications that have gone quiet, longest wait first.
 *
 * Rejected, withdrawn, offered, and merely-saved rows are excluded: only something
 * you are actually waiting on can be chased.
 */
export function staleApplications(records: ApplicationRecord[], now = Date.now(), afterDays = STALE_AFTER_DAYS): StaleApplication[] {
  return records
    .filter((record) => AWAITING_STATUSES.has(record.status))
    .flatMap((record) => {
      const last = parse(record.updated_at) ?? activityTime(record);
      if (last === null) return [];
      const days = Math.floor((now - last) / DAY_MS);
      if (days < afterDays) return [];
      const label = [record.job?.title, record.job?.company].filter(Boolean).join(" · ") || "Untitled application";
      return [{ label, status: record.status, days }];
    })
    .sort((a, b) => b.days - a.days);
}

export interface NextActionInput {
  onboardingCompleted: boolean;
  resumeCount: number;
  answerCount: number;
  jobCount: number;
  reviewCount: number;
  staleCount: number;
  savedCount: number;
}

/**
 * The single most useful next step, plus runners-up.
 *
 * Ordered by what blocks the most downstream value: a profile that cannot answer
 * questions makes every other feature weaker, and data that is wrong is worse than
 * data that is missing, so review outranks volume.
 */
export function nextActions(input: NextActionInput): NextAction[] {
  const actions: NextAction[] = [];
  if (!input.onboardingCompleted) {
    actions.push({ id: "onboarding", label: "Finish onboarding", detail: "Your profile powers every answer.", href: "/onboarding" });
  }
  if (input.resumeCount === 0) {
    actions.push({ id: "resume", label: "Import your resume", detail: "This fills most of your profile in one step.", href: "/profile" });
  }
  if (input.reviewCount > 0) {
    actions.push({
      id: "review",
      label: `Review ${input.reviewCount} extracted field${input.reviewCount === 1 ? "" : "s"}`,
      detail: "Some values look mis-parsed and would be sent as-is.",
      href: "/profile#overview",
    });
  }
  if (input.staleCount > 0) {
    actions.push({
      id: "stale",
      label: `Follow up on ${input.staleCount} application${input.staleCount === 1 ? "" : "s"}`,
      detail: `No movement in over ${STALE_AFTER_DAYS} days.`,
      href: "/tracker",
    });
  }
  if (input.savedCount > 0) {
    actions.push({ id: "saved", label: `Apply to ${input.savedCount} saved job${input.savedCount === 1 ? "" : "s"}`, detail: "Saved but not yet submitted.", href: "/tracker" });
  }
  if (input.answerCount === 0) {
    actions.push({ id: "answers", label: "Build your answer library", detail: "Saved answers respond instantly and cost nothing.", href: "/answer-library" });
  }
  if (input.jobCount === 0) {
    actions.push({ id: "track", label: "Track your first opportunity", detail: "Install the extension, then save a job.", href: "/tracker" });
  }
  return actions;
}
