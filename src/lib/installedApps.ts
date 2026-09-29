import { useEffect, useState } from "react";
import { native } from "./native";
import type { InstalledApp } from "./types";

// One scan per app session unless the picker asks to rescan.
let cache: Promise<InstalledApp[]> | null = null;
const listeners = new Set<() => void>();

export function loadInstalledApps(refresh = false): Promise<InstalledApp[]> {
  if (!cache || refresh) {
    cache = native.listInstalledApps(refresh).catch(() => []);
    void cache.then(() => listeners.forEach((l) => l()));
  }
  return cache;
}

/** Installed apps, or null while the scan runs. */
export function useInstalledApps(): InstalledApp[] | null {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  useEffect(() => {
    let live = true;
    const sync = () => void loadInstalledApps().then((a) => live && setApps(a));
    sync();
    listeners.add(sync);
    return () => {
      live = false;
      listeners.delete(sync);
    };
  }, []);
  return apps;
}
