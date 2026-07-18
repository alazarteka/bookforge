# Initial Architecture Decisions

These are starting decisions, not an immutable public contract. Revisit them
only with a concrete failing fixture or implementation constraint.

## D-001: TypeScript and Node.js 24 LTS

Status: accepted.

Bookforge uses TypeScript because rendering, CSS tooling, preview behavior,
image processing, EPUB packaging, and Vivliostyle all live naturally in the
Node ecosystem. Pandoc and EPUBCheck are external processes regardless of the
orchestration language.

## D-002: Pandoc is a parser, not the canonical model

Status: accepted.

Pandoc JSON is transient. Bookforge immediately converts supported constructs
into an owned `Publication` IR that represents book semantics and stable
identity.

## D-003: All three outputs remain in the first complete release

Status: accepted.

HTML and EPUB are implemented first; a narrow PDF adapter follows before the
MVP is considered complete. Advanced commercial-print features remain out of
scope.

## D-004: Explicit ordered chapters

Status: accepted for version one.

`book.yaml` contains the ordered spine and stable chapter IDs. Automatic
splitting of a monolithic Markdown file is deferred.

## D-005: Generated publications are static

Status: accepted.

The web edition is static HTML/CSS with optional progressive JavaScript. EPUB
contains no required script. PDF is generated from static print HTML.

## D-006: One semantic model, separate output policies

Status: accepted.

Design tokens and body typography may be shared. Web interaction, EPUB
packaging/footnotes, and print pagination/page furniture are format-specific.

## D-007: Raw HTML and network resources are rejected initially

Status: accepted.

This keeps the supported Markdown contract testable and prevents manuscripts
from bypassing output safety or reproducibility rules.

## D-008: Stable identifiers are an early design deliverable

Status: accepted.

Chapter IDs are explicit. Heading, footnote, and asset identifiers are
deterministic and covered by golden tests before renderer work proceeds.

## D-009: Use a CLI boundary for Vivliostyle initially

Status: accepted provisionally.

Even though Bookforge is a Node project, the pinned Vivliostyle CLI provides a
cleaner replaceable process boundary than depending directly on internal APIs.
This can be revised if the official JavaScript API proves materially safer or
more capable.

## D-010: Personal-first, clean-boundary scope

Status: accepted.

Bookforge does not promise a stable external plugin or theme API in its first
release. It still records schema versions and keeps clean boundaries to avoid
throwaway implementation decisions.

## D-011: Themes and production profiles are separate

Status: accepted.

Themes control cross-format visual language through validated CSS and declared
assets. Print profiles independently control page geometry, margins, binding,
color mode, bleed, and cover mode. Bookforge owns semantic output structures;
version-one themes do not inject arbitrary templates.
