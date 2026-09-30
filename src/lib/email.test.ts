import { renderEmail, SAMPLES, escapeHtml } from "../../supabase/functions/_shared/email";

describe("emails", () => {
  it("renders every kind with a subject, preheader, HTML, and plain text", () => {
    for (const s of SAMPLES) {
      const e = renderEmail(s.kind, s.data);
      expect(e.subject.length).toBeGreaterThan(5);
      expect(e.preheader.length).toBeGreaterThan(5);
      expect(e.html).toContain("<!doctype html>");
      expect(e.html).toContain(escapeHtml(e.subject));
      expect(e.text.split("\n")[0]).not.toBe("");
      // Declarative voice: no questions in subjects or headings.
      expect(e.subject).not.toContain("?");
    }
  });

  it("puts the reason, session, and review button in the unlock request", () => {
    const e = renderEmail("unlock_request", { who: "Ryan", profile: "Interview Prep", minutesIn: 18, detail: "Recruiter moved my call up.", link: "https://p.example/approve/1" });
    expect(e.subject).toBe("Ryan wants to break their seal");
    expect(e.html).toContain("18 minutes into Interview Prep");
    expect(e.html).toContain("“Recruiter moved my call up.”");
    expect(e.html).toContain('href="https://p.example/approve/1"');
    expect(e.text).toContain("Review request: https://p.example/approve/1");
    // No link, no button.
    expect(renderEmail("unlock_request", { who: "Ryan" }).html).not.toContain("Review request");
  });

  it("escapes what people typed", () => {
    const e = renderEmail("unlock_request", { who: "<b>Ryan</b>", detail: `"><script>alert(1)</script>` });
    expect(e.html).not.toContain("<script>");
    expect(e.html).not.toContain("<b>Ryan</b>");
    expect(e.html).toContain("&#60;script&#62;");
  });

  it("tells you what your partner decided", () => {
    expect(renderEmail("unlock_decided", { partner: "Alex", approved: true }).subject).toBe("Alex approved your unlock");
    const denied = renderEmail("unlock_decided", { partner: "Alex", approved: false, note: "Finish the set." });
    expect(denied.subject).toBe("Alex kept your seal");
    expect(denied.text).toContain('Alex said: "Finish the set."');
  });

  it("keeps Supabase's placeholder in the sign-in templates", () => {
    expect(renderEmail("magic_link", { link: "{{ .ConfirmationURL }}" }).html).toContain('href="{{ .ConfirmationURL }}"');
  });
});
