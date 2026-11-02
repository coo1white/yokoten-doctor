# 0001 Keep Astro and plain CSS in the rebuild

Status: accepted
Date: 2026-11-02 (UTC)

## Context

The owner lifted every limit on the stack for the rebuild to the approved design (issue #96). The site has one form, one stream and static pages. The hackathon deadline is 2026-11-05 02:00 UTC.

## Decision

The rebuild stays on Astro, TypeScript and plain CSS. It rewrites the client's `ui` code and the styles in the same style. It adds no framework and no package.

## Options not taken

- **Astro with a Preact island:** it would let example pages work without JavaScript. It adds one dependency and a rewrite of the DOM tests. It is worth doing after the hackathon.
- **Tailwind:** the design is a short token list and one state system, so it would be a second source of truth with no visual gain.
- **daisyUI:** its look and state layers are what PR 90 replaced.
- **React, TanStack and Tailwind as a single-page app:** the site needs no router, query cache or table. Example pages would become client-only, and most test files would go.

## Consequences

- The same CSP, deploy and tests stay in place.
- The DOM code stays long-winded.
- A result page still needs JavaScript to show. It says so in `<noscript>`.
