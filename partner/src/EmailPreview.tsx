import { useState } from "react";
import { renderEmail, SAMPLES } from "../../supabase/functions/_shared/email";

// Dev only (npm run dev, then /emails): every email Sanctum sends, rendered with sample data,
// in HTML and plain text. Nothing is sent.

export default function EmailPreview() {
  const [i, setI] = useState(0);
  const [plain, setPlain] = useState(false);
  const sample = SAMPLES[i]!;
  const e = renderEmail(sample.kind, sample.data);
  return (
    <div className="emails">
      <nav aria-label="Emails">
        <strong>Emails</strong>
        {SAMPLES.map((s, n) => (
          <button key={n} className={n === i ? "on" : ""} onClick={() => setI(n)}>
            {s.label}
          </button>
        ))}
      </nav>
      <section>
        <div className="meta">
          <div>
            <span className="small">Subject</span>
            <strong>{e.subject}</strong>
          </div>
          <div>
            <span className="small">Preview line</span>
            <span className="muted">{e.preheader}</span>
          </div>
          <button className="ghost" onClick={() => setPlain(!plain)}>
            {plain ? "Show HTML" : "Show plain text"}
          </button>
        </div>
        {plain ? <pre className="plain">{e.text}</pre> : <iframe title={e.subject} srcDoc={e.html} className="frame" />}
      </section>
    </div>
  );
}
