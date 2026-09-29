import { native } from "./native";
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
