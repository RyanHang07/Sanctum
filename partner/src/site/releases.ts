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
