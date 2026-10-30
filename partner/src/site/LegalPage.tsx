import { useMemo, useState } from "react";
import { A } from "./nav";
import { REPO } from "./releases";
import { useTabTitle } from "../title";
import notices from "./notices.json";

// /legal (v0.3): Sanctum's license, the open-source libraries it ships (scripts/licenses.mjs
// reads them from the build's own dependencies), and a note on the names of other products.

interface Notice {
  group: string;
  name: string;
  version: string;
  license: string;
  url: string;
}

const LICENSE = `MIT License

Copyright (c) 2026 Ryan Hang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ALL = notices as Notice[];

export function LegalPage() {
  useTabTitle("Legal");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? ALL.filter((n) => n.name.toLowerCase().includes(s) || n.license.toLowerCase().includes(s)) : ALL;
  }, [q]);
  const groups = [...new Set(ALL.map((n) => n.group))];

  return (
    <article className="legal-page">
      <h1 className="headline">
        Legal. <em>In plain view.</em>
      </h1>
      <p className="lede">
        Sanctum is free and open source. This page has its license, the libraries it's built on, and a note on other products' names. How your data is
        handled is in the <A href="/privacy">privacy policy</A>; the rules of use are in the <A href="/terms">terms</A>.
      </p>

      <section className="legal-block" aria-labelledby="license">
        <h2 id="license">Sanctum's license</h2>
        <p className="muted">
          The app, its browser extension, and this site are published under the MIT License. The source is at <a href={REPO}>github.com/ryanhang07/sanctum</a>.
        </p>
        <pre className="license">{LICENSE}</pre>
      </section>

      <section className="legal-block" aria-labelledby="names">
        <h2 id="names">Other products' names</h2>
        <p className="muted">
          Sanctum's themes are named after the colour schemes they follow: GitHub, Dracula, One Dark, Monokai, Tokyo Night, Catppuccin, Nord, Gruvbox, and
          Solarized. Those names belong to their owners, and Sanctum isn't affiliated with or endorsed by them. The same goes for the browsers, apps, and
          services Sanctum mentions or works with, such as Windows, Chrome, Edge, Brave, Comet, Google Calendar, Discord, and YouTube.
        </p>
      </section>

      <section className="legal-block" aria-labelledby="notices">
        <h2 id="notices">Open-source notices</h2>
        <p className="muted">
          Sanctum is built on {ALL.length} open-source packages, each under its own license, listed from the dependencies of the build. Each name links to
          its page, where its full license and copyright notice are. The fonts (Geist, Geist Mono, Instrument Serif) are under the SIL Open Font License.
        </p>
        <input className="notice-search" type="search" placeholder="Find a package or license" aria-label="Find a package or license" value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map((g) => {
          const rows = shown.filter((n) => n.group === g);
          if (!rows.length) return null;
          return (
            <details key={g} className="notice-group" open={!!q.trim()}>
              <summary>
                {g} <span className="muted">· {rows.length}</span>
              </summary>
              <div className="doc-table">
                <table>
                  <thead>
                    <tr>
                      <th>Package</th>
                      <th>Version</th>
                      <th>License</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((n) => (
                      <tr key={`${n.name}@${n.version}`}>
                        <td>
                          <a href={n.url} target="_blank" rel="noopener noreferrer">
                            {n.name}
                          </a>
                        </td>
                        <td className="mono">{n.version}</td>
                        <td>{n.license}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
        {!shown.length ? <p className="muted">Nothing matches “{q.trim()}”.</p> : null}
      </section>
    </article>
  );
}
