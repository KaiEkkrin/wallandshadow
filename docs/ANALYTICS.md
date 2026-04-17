# Analytics on the Self-Hosted Stack

Google Analytics is being removed as part of the Firebase decommission (see
@docs/FIREBASE_REMOVAL.md). This document sketches, in broad strokes, what a
non-Google-dependent analytics stack on our Hetzner deployment might look like, so we
can decide later whether to replace GA or simply live without it.

**Status**: unfunded. No analytics in the Hono stack today. Server request logs are the
only source of truth for traffic.

---

## Do we need it at all?

Current traffic is small and most users are known personally. Server logs (Caddy access
logs + Node.js request logs) already answer:

- Is the site up and being used?
- Which endpoints are slow or erroring?
- Roughly how many unique visitors per day?

What logs do **not** answer:

- Which landing-page sections actually hold attention?
- Do new users hit a dead end at a particular step (create-adventure, invite, first map)?
- Which browsers / viewports are in real use so we can scope testing sensibly?
- Are we retaining players beyond their first session?

If the landing page stays simple and onboarding stays small, none of those questions are
urgent. If we ever market the app more actively, they become useful. Build analytics when
we have a concrete question to answer with it — not speculatively.

---

## Principles (if and when we build it)

1. **Self-hosted and EU-resident.** Same rationale as the rest of the replatform: no
   third-party data processor, no GDPR consent banner required if we stay on
   anonymous/aggregate data.
2. **No cookies, no fingerprinting.** Cookie-less analytics let us skip the consent
   banner entirely — a huge UX win over the Google Analytics world we came from.
3. **Aggregate, not individual.** We do not want a per-user event trail. Page views,
   approximate sessions, top referrers — that's the bar.
4. **Small.** This is a personal/small-group VTT. A full product-analytics stack is
   overkill and a long-term maintenance burden.
5. **Off by default in dev.** The analytics endpoint should be wired only in production
   builds, with no-op stubs elsewhere, so developers don't pollute real data.

---

## Candidate tools

| Tool          | License       | Hosting model                   | Notes                                                                         |
| ------------- | ------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| **Plausible** | AGPL / Cloud  | Single Docker container + PG    | Cookie-less, GDPR-friendly defaults, small footprint, simple dashboard        |
| **Umami**     | MIT / Cloud   | Single Docker container + PG    | Similar shape to Plausible; MIT licence is more permissive                    |
| **Matomo**    | GPL / Cloud   | PHP + MySQL                     | Much larger surface; feature-rich but heavier; probably overkill              |
| **GoatCounter**| EU AGPL      | Single binary + SQLite/PG       | Tiny, opinionated, EU-origin. Minimalist — a good match philosophically       |
| **Caddy logs** | —            | Already present                 | Baseline; parse with GoAccess or similar for a cheap first step               |

Current leaning: **Plausible or Umami.** Both are one container alongside the existing
stack, share PostgreSQL if we want, and use the same cookie-less page-beacon script.
GoatCounter is attractive if we want to stay extra-small.

A cheaper first step: **Caddy access logs + GoAccess** (static HTML report) gets us
page-view counts, referrers, and user agents for zero added infrastructure. Might be
enough.

---

## Rough shape

If we do build it:

- Add the analytics container to the VPS (same systemd + `docker run` pattern as the
  API server). PostgreSQL is already on the box; share it or give the analytics tool
  its own database.
- Caddy reverse-proxies `/a/*` (or similar) to the analytics container for the beacon
  endpoint, so the client never makes cross-origin analytics calls.
- Client: a small hook that fires page-view events on route changes. No per-user
  identifiers. No event payloads beyond route + referrer unless we have a specific
  question we're trying to answer.
- Dashboard: protected by the analytics tool's own auth (e.g. Plausible/Umami admin
  login) or by Caddy basic auth.

## Replacing the Google Analytics consent banner

Part of the Firebase removal is deleting `AnalyticsContextProvider`, `AnalyticsContext`,
and the `Consent` banner. Authentication storage (OIDC tokens in localStorage / session
cookies) is *strictly necessary* for a service the user has explicitly requested to use
and is therefore exempt from the EU cookie/consent requirement — so removing GA alone
is enough to remove the banner. No other persistent client state requires consent today.

If we pick a cookie-less analytics replacement (Plausible, Umami, or GoatCounter in
their default configurations), the site stays consent-banner-free. If we ever pick a
tool that sets tracking cookies or stores anything personal, we reintroduce a banner —
but at that point we should question whether we picked the right tool.

---

## Open questions

- What specific question would make us glad we had analytics? If we can't name one, we
  probably don't need any tool beyond server logs right now.
- Do we want public dashboards (Plausible supports sharable links) so the team can peek
  without logging in?
- Any retention-period rules we want to impose (e.g. roll analytics data after 90 days)?
