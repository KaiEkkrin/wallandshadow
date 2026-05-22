# Public GitHub repo — content inventory

_Planning document / draft. This file lists what should live in the **public**
Wall & Shadow GitHub repository. It is a working inventory for the maintainer,
not a website page and not something the application renders._

## Purpose

The GitHub repo is a **project** page — for developers and contributors. The
website (wallandshadow.com) is the **product** — for end users. Legal and safety
text that an end user, a regulator, or a content reporter needs must be reachable
from the product itself. The repo holds the *source* of that text, but it is not
the delivery surface — see `drafts/about/` for the draft product text.

## README restructure

The current `README.md` mixes a product intro, developer setup, and a
contributor-facing "AI Policy". Recommended:

- Keep the README primarily **developer / contributor focused** — setup, dev
  container, architecture, testing, deployment.
- Add a short section near the top: "Wall & Shadow is live at
  https://wallandshadow.com — see the in-app About section for Terms, Privacy,
  and acknowledgements." Link out; do **not** duplicate the legal text here.
- Keep the existing **AI Policy** section — it concerns how the *code* is
  maintained, which is a contributor matter, not a product matter.
- The stray `wallandshadow.io` references have been corrected to
  `wallandshadow.com` (canonical domain, settled).

## Canonical source of the legal text

Recommendation: the published Terms, Privacy Notice, About, and acknowledgements
text lives as **markdown in the public repo**, and is rendered by the React app.
This gives a versioned, auditable history of every change to the legal text for
free, and keeps a single source of truth.

The reviewed `drafts/about/*.md` files are the seed for whatever directory holds
the canonical published versions once the text is approved.

## New project files to add

- **`CONTRIBUTING.md`** — how to contribute: a dev-environment pointer,
  build/test expectations, and the project's stance on generative-AI assistance
  in contributions.
- **`CODE_OF_CONDUCT.md`** — a standard contributor code of conduct. This
  governs *contributors to the project*, and is distinct from the product's
  in-app Acceptable Use Policy (which governs *users of the service*).
- **`SECURITY.md`** — how to report **security vulnerabilities in the code** — a
  private disclosure channel, e.g. GitHub private vulnerability reporting plus an
  email. This is distinct from `abuse@`, which is for illegal *content*.

## THIRD-PARTY-NOTICES tooling

The licence-aggregation tooling and the Vite build step that generates the
`third-party-notices.txt` artifact (see the main implementation plan) live in the
public repo. The generated artifact itself is a build output and is **not**
committed.

## What stays OUT of the public repo

The operational abuse runbook, escalation contacts, admin identities, and
internal records — see `github-private-rundown.md`.
