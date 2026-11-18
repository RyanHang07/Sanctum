import { useEffect, useState } from "react";

// Sanctum's releases, read live from GitHub (v0.2 site). The release workflow writes each
// version's CHANGELOG.md section into its notes, so this is the changelog. Read once per visit.

export const REPO = "https://github.com/ryanhang07/sanctum";
export const DOWNLOAD = `${REPO}/releases/latest`;
const API = "https://api.github.com/repos/ryanhang07/sanctum/releases?per_page=30";

export interface Release {
  tag: string;
  name: string;
  date: string;
  notes: string;
  url: string;
  /** The Windows installer, when the release has one. */
  installer: string | null;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

let once: Promise<Release[]> | null = null;

export function fetchReleases(): Promise<Release[]> {
  once ??= fetch(API, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? (r.json() as Promise<GitHubRelease[]>) : Promise.reject(new Error(String(r.status)))))
    .then((list) =>
      list
        .filter((r) => !r.draft && !r.prerelease && r.published_at)
        .map((r) => ({
          tag: r.tag_name,
          name: r.name || r.tag_name,
          date: r.published_at!,
          notes: r.body ?? "",
          url: r.html_url,
          installer: r.assets.find((a) => a.name.endsWith("-setup.exe"))?.browser_download_url ?? null,
        })),
    )
    .catch((e: unknown) => {
      once = null; // try again next time
      throw e;
    });
  return once;
}

export type Releases = { kind: "loading" } | { kind: "ready"; list: Release[] } | { kind: "offline" };

export function useReleases(): Releases {
  const [state, setState] = useState<Releases>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    fetchReleases().then(
      (list) => live && setState({ kind: "ready", list }),
      () => live && setState({ kind: "offline" }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

// The repo's star count for the top bar (2026-11-18): one public read per visit, like the
// releases. Null until it loads, and if GitHub can't be reached the bar shows the button without it.
let starsOnce: Promise<number | null> | null = null;

export function fetchStars(): Promise<number | null> {
  starsOnce ??= fetch("https://api.github.com/repos/ryanhang07/sanctum", { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? (r.json() as Promise<{ stargazers_count?: number }>) : null))
    .then((repo) => (typeof repo?.stargazers_count === "number" ? repo.stargazers_count : null))
    .catch(() => null);
  return starsOnce;
}

/** "842", "1.2k", "12k". */
export function starCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? Math.floor(k * 10) / 10 : Math.floor(k)}k`;
}

export function useStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void fetchStars().then((n) => live && setStars(n));
    return () => {
      live = false;
    };
  }, []);
  return stars;
}
