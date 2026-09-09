/**
 * Tests for the dashboard activity model.
 *
 * Time-dependent behaviour is pinned to a fixed `now` so these cannot drift or fail
 * intermittently at day boundaries.
 */

import { describe, expect, it } from "vitest";
import { applicationVelocity, localDayKey, nextActions, staleApplications, STALE_AFTER_DAYS } from "./application-insights";
import type { ApplicationRecord } from "./application-insights";

const NOW = new Date("2026-09-09T12:00:00.000Z").getTime();
const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

/** Expected bucket key for N days ago, in the same local calendar the chart uses. */
function keyDaysAgo(days: number): string {
  return localDayKey(NOW - days * DAY);
}

function record(overrides: Partial<ApplicationRecord>): ApplicationRecord {
  return { status: "applied", created_at: daysAgo(1), ...overrides };
}

describe("application velocity", () => {
  it("emits every day in the window, including empty ones", () => {
    // Gaps are the point: omitting them would make a quiet week look busy.
    const buckets = applicationVelocity([], 30, NOW);
    expect(buckets).toHaveLength(30);
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("counts submitted applications on the day they were sent", () => {
    const buckets = applicationVelocity([
      record({ applied_at: daysAgo(2) }),
      record({ applied_at: daysAgo(2) }),
      record({ applied_at: daysAgo(5) }),
    ], 30, NOW);
    const byDate = Object.fromEntries(buckets.map((bucket) => [bucket.date, bucket.count]));
    expect(byDate[keyDaysAgo(2)]).toBe(2);
    expect(byDate[keyDaysAgo(5)]).toBe(1);
  });

  it("ignores saved leads that were never submitted", () => {
    const buckets = applicationVelocity([record({ status: "saved", applied_at: daysAgo(1) })], 30, NOW);
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(0);
  });

  it("ignores activity older than the window", () => {
    const buckets = applicationVelocity([record({ applied_at: daysAgo(60) })], 30, NOW);
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(0);
  });

  it("falls back to created_at when applied_at is absent", () => {
    // applied_at is only populated going forward, so history must still chart.
    const buckets = applicationVelocity([record({ applied_at: null, created_at: daysAgo(3) })], 30, NOW);
    expect(buckets.find((bucket) => bucket.date === keyDaysAgo(3))?.count).toBe(1);
  });
});

describe("stale applications", () => {
  it("flags an application with no movement past the threshold", () => {
    const stale = staleApplications([
      record({ status: "applied", updated_at: daysAgo(20), job: { company: "Stripe", title: "Engineer" } }),
    ], NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].days).toBe(20);
    expect(stale[0].label).toBe("Engineer · Stripe");
  });

  it("leaves recent applications alone", () => {
    expect(staleApplications([record({ updated_at: daysAgo(STALE_AFTER_DAYS - 1) })], NOW)).toHaveLength(0);
  });

  it("never nags about a closed outcome", () => {
    // Chasing a rejection or an accepted offer is noise, not a next action.
    const closed = staleApplications([
      record({ status: "rejected", updated_at: daysAgo(40) }),
      record({ status: "withdrawn", updated_at: daysAgo(40) }),
      record({ status: "offer", updated_at: daysAgo(40) }),
      record({ status: "saved", updated_at: daysAgo(40) }),
    ], NOW);
    expect(closed).toHaveLength(0);
  });

  it("orders the longest wait first", () => {
    const stale = staleApplications([
      record({ status: "applied", updated_at: daysAgo(20) }),
      record({ status: "interview", updated_at: daysAgo(45) }),
    ], NOW);
    expect(stale[0].days).toBe(45);
  });
});

describe("next actions", () => {
  const base = { onboardingCompleted: true, resumeCount: 1, answerCount: 5, jobCount: 3, reviewCount: 0, staleCount: 0, savedCount: 0 };

  it("is empty for a fully set-up account with nothing pending", () => {
    expect(nextActions(base)).toHaveLength(0);
  });

  it("puts onboarding first because everything else depends on it", () => {
    expect(nextActions({ ...base, onboardingCompleted: false, resumeCount: 0 })[0].id).toBe("onboarding");
  });

  it("ranks correcting bad data above adding more of it", () => {
    const actions = nextActions({ ...base, reviewCount: 3, savedCount: 4 });
    const review = actions.findIndex((action) => action.id === "review");
    const saved = actions.findIndex((action) => action.id === "saved");
    expect(review).toBeLessThan(saved);
  });

  it("surfaces follow-ups when applications have gone quiet", () => {
    const action = nextActions({ ...base, staleCount: 2 }).find((entry) => entry.id === "stale");
    expect(action?.label).toMatch(/2 applications/);
    expect(action?.href).toBe("/tracker");
  });

  it("uses singular wording for a single item", () => {
    expect(nextActions({ ...base, staleCount: 1 }).find((entry) => entry.id === "stale")?.label).toMatch(/1 application\b/);
  });
});
