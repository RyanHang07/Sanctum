import { inTauri, native } from "./native";
import { mockControls } from "./mockBackend";
import { addDays, todayKey } from "./planner";
import { sampleProfiles } from "./catalog";
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
      { ...base, title: "Weigh-in", daysMask: 0b0010010, time: "08:00" },
      { ...base, title: "Morning meeting", daysMask: WEEKDAYS_MASK, time: "09:00", durationMin: 30 },
      { ...base, title: "Gym", daysMask: 0b0101010 },
      { ...base, title: "NeetCode daily", daysMask: EVERY_DAY, profileId: id("Interview Prep") },
      { ...base, title: "Work session: SQL + DSA", daysMask: WEEKDAYS_MASK, time: "10:00", durationMin: 60, profileId: id("Interview Prep") },
      { ...base, title: "Job search: 5 applications", daysMask: WEEKDAYS_MASK, profileId: id("Light Work") },
      { ...base, title: "Work session: verbal interview prep", daysMask: 0b0010100, time: "16:00", durationMin: 60, profileId: id("Interview Prep") },
      { ...base, title: "Evening Filmadi meeting", daysMask: WEEKDAYS_MASK, time: "18:00", durationMin: 60 },
    ];
    for (const r of routines) await native.saveRoutine(r);
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
  for (let i = 42; i >= 1; i--) {
    const k = addDays(today, -i);
    const n = (i * 37) % 11;
    if (n === 3) continue; // a missed day
    const focusMin = 60 + n * 18;
    days[k] = { focusMin, attempts: n % 4, productiveMin: focusMin + 40, distractingMin: 10 + n * 3 };
    if (i === 17) days[k]!.brokenAt = new Date(`${k}T14:14:00`).getTime();
  }
  mockControls.statsDays(days, [
    { what: "discord.exe", kind: "app", count: 9 },
    { what: "youtube.com", kind: "site", count: 6 },
    { what: "“shorts”", kind: "title", count: 4 },
    { what: "steam.exe", kind: "allowlist", count: 2 },
  ]);
}
