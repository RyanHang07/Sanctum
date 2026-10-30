import { inTauri, native } from "./native";
import { mockControls } from "./mockBackend";
import { addDays, todayKey, weekStart } from "./planner";
import { catalogDistractions, sampleProfiles } from "./catalog";
import { EVERY_DAY, WEEKDAYS_MASK } from "./planner";

let running: Promise<void> | null = null;

/**
 * Dev builds only: seed the four sample profiles once, for testing. Release builds start
 * empty and get their profiles from onboarding (M5). Dev builds use their own database
 * (sanctum-dev.db), so this never reaches a real install.
 *
 * Single-flight: StrictMode runs startup effects twice, and two concurrent seeds would
 * both see an empty table.
 */
export function seedDevProfiles(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return Promise.resolve();
  running ??= (async () => {
    if ((await native.getSetting("dev_seeded")) === "1") return;
    if ((await native.listProfiles()).length === 0) {
      for (const draft of sampleProfiles()) await native.createProfile(draft);
      // The four common distractions onboarding starts with.
      for (const g of catalogDistractions().filter((g) => ["Discord", "YouTube", "Instagram", "TikTok"].includes(g.label))) {
        for (const item of g.items) await native.addDistraction(item);
      }
    }
    await native.setSetting("dev_seeded", "1");
    await native.setSetting("onboarded", "1");
  })();
  return running;
}

let plannerRun: Promise<void> | null = null;

/** Dev builds only: sample routines from Home.dc.html, so schedule-driven focus has something to show. */
export function seedDevPlanner(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return Promise.resolve();
  plannerRun ??= (async () => {
    await seedDevProfiles();
    if ((await native.getSetting("dev_seeded_planner")) === "1") return;
    const profiles = await native.listProfiles();
    const id = (name: string) => profiles.find((p) => p.name === name)?.id ?? null;
    const base = { active: true, durationMin: null, profileId: null, time: null };
    const routines = [
      { ...base, title: "Morning run", daysMask: 0b0101010, time: "07:00", durationMin: 30 },
      { ...base, title: "Plan the day", daysMask: WEEKDAYS_MASK, time: "09:00", durationMin: 15 },
      { ...base, title: "Deep work", daysMask: WEEKDAYS_MASK, time: "10:00", durationMin: 90, profileId: id("Deep Work") },
      { ...base, title: "LeetCode practice", daysMask: EVERY_DAY, profileId: id("Interview Prep") },
      { ...base, title: "Read 20 pages", daysMask: EVERY_DAY },
      { ...base, title: "Inbox and Slack", daysMask: WEEKDAYS_MASK, time: "16:30", durationMin: 30, profileId: id("Light Work") },
      { ...base, title: "Gym", daysMask: 0b0010100 },
    ];
    for (const r of routines) await native.saveRoutine(r);
    await native.saveTodo({ title: "Send the weekly update", dueDate: todayKey(), dueTime: null, durationMin: null, profileId: id("Light Work") });
    // Pending: this week's things with no day yet, and one for next week.
    const week = weekStart(todayKey());
    for (const title of ["Renew passport", "Book the dentist", "Back up the laptop"]) {
      await native.saveTodo({ title, dueDate: week, dueTime: null, durationMin: null, profileId: null, undated: true });
    }
    await native.saveTodo({ title: "Plan the trip", dueDate: addDays(week, 7), dueTime: null, durationMin: null, profileId: null, undated: true });
    await native.setSetting("dev_seeded_planner", "1");
  })();
  return plannerRun;
}

/**
 * Browser preview only (no Tauri): six weeks of sample history so Stats has something to
 * show. A real install builds it from sessions.
 */
export function seedDevStats(): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test" || inTauri()) return;
  const today = todayKey();
  const days: Parameters<typeof mockControls.statsDays>[0] = {};
  // This week's days carry the attempts the "What tempted you" list adds up to (21).
  const dow = (new Date().getDay() + 6) % 7;
  const weekAttempts = [8, 7, 6, 0, 0, 0];
  for (let i = 42; i >= 1; i--) {
    const k = addDays(today, -i);
    const n = (i * 37) % 11;
    if (n === 3) continue; // a missed day
    const focusMin = 60 + n * 18;
    const thisWeek = i <= dow;
    days[k] = { focusMin, attempts: thisWeek ? (weekAttempts[dow - i] ?? 0) : n % 4, productiveMin: focusMin + 40, distractingMin: 10 + n * 3 };
    if (i === 17) days[k]!.brokenAt = new Date(`${k}T14:14:00`).getTime();
  }
  mockControls.statsDays(days, [
    { what: "discord.exe", kind: "app", count: 9 },
    { what: "youtube.com", kind: "site", count: 6 },
    { what: "“shorts”", kind: "title", count: 4 },
    { what: "steam.exe", kind: "allowlist", count: 2 },
  ]);

  // Stats in depth (v0.3): sessions and activity for the last two weeks, and last week's recap.
  const at = (key: string, h: number, m = 0) => new Date(`${key}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
  const PLAN: [string, number, number, "completed" | "unlocked_early" | "broken"][] = [
    ["Deep Work", 9, 90, "completed"],
    ["Interview Prep", 13, 60, "completed"],
    ["Study", 16, 45, "completed"],
  ];
  // Once: StrictMode mounts the shell twice in development.
  if (mockControls.insightState().sessions.length) return;
  for (let i = 13; i >= 0; i--) {
    const k = addDays(today, -i);
    PLAN.forEach(([profileName, hour, plannedMin, outcome], j) => {
      if ((i + j) % 5 === 4) return;
      const broken = i === 6 && j === 1;
      const startedAt = at(k, hour);
      mockControls.insightSession(
        { profileName, startedAt, plannedMin, focusMin: broken ? 22 : plannedMin, outcome: broken ? "broken" : i === 3 && j === 2 ? "unlocked_early" : outcome },
        { blocked: (i + j) % 3 ? [{ what: "discord.exe", kind: "app", count: 1 + ((i + j) % 3) }] : [], tamper: broken ? [{ at: startedAt + 22 * 60_000, what: "Sanctum was closed" }] : [] },
      );
      const s = startedAt;
      mockControls.insightActivity([
        { ts: s, seconds: plannedMin * 30, exe: "code.exe", title: "main.rs - Sanctum", category: "productive", sessionId: null },
        { ts: s + plannedMin * 30_000, seconds: plannedMin * 15, exe: "chrome.exe", title: "Two Sum - LeetCode — leetcode.com", category: "productive", sessionId: null },
        { ts: s + plannedMin * 45_000 + 60_000, seconds: 240, exe: "chrome.exe", title: "Shorts - YouTube — youtube.com", category: "distracting", sessionId: null },
        { ts: s + plannedMin * 60_000 + 120_000, seconds: 900, exe: "slack.exe", title: "Slack", category: "neutral", sessionId: null },
      ]);
    });
  }
  mockControls.insightRecap({ week: addDays(today, -7), focusMin: 1140, previousFocusMin: 960, kept: 5, broken: 1, days: 6, bestDay: addDays(today, -5), bestDayMin: 240, mostTempting: "discord.exe", sessions: 16 });
}

/**
 * Browser preview only (no Tauri): trackers from Tracking.dc.html with a few months of
 * entries, a weigh-in, and an evening wrap-up. A real install starts with none.
 */
export async function seedDevTrackers(): Promise<void> {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test" || inTauri()) return;
  if ((await native.listTrackers()).length) return;
  const w = await native.saveTracker({ name: "Weight", kind: "number", unit: "lb" });
  const sleep = await native.saveTracker({ name: "Sleep", kind: "number", unit: "h" });
  const mood = await native.saveTracker({ name: "Mood", kind: "scale", display: "chart" });
  const journal = await native.saveTracker({ name: "Journal", kind: "text" });
  const days = Array.from({ length: 30 }, (_, i) => 104 - i * 3.5);
  mockControls.history(w.id, days.map((d, i) => [d, Math.round((184 - (11.6 * i) / 29 + Math.sin(i * 1.3) * 0.7) * 10) / 10]));
  mockControls.history(sleep.id, days.map((d, i) => [d, Math.round((6.1 + (1.3 * i) / 29 + Math.sin(i * 1.7) * 0.35) * 10) / 10]));
  mockControls.history(mood.id, days.slice(-12).map((d, i) => [d, 5 + ((i * 3) % 5)]));
  mockControls.history(journal.id, [[2, "Shipped the refactor. Two seals kept."], [1, "Slept badly. Kept the seal anyway."]]);
  await native.saveCheckin({ id: 0, name: "Morning check-in", time: "08:00", daysMask: WEEKDAYS_MASK, trackerIds: [w.id, sleep.id], includeGoalReview: false });
  await native.saveCheckin({ id: 0, name: "Evening wrap-up", time: "21:30", daysMask: EVERY_DAY, trackerIds: [mood.id, journal.id], includeGoalReview: true });
}
