# DevsMind Knowledge Graph Audit — per-repo + aggregate

Target: `C:/work/Hanoot/backend/lamda/harrir-docs-information/harrir-brains/.devmind`
(8 repos, ~7,800 nodes, ~17k+ edges)

Use `better-sqlite3` directly against `brain.db` (the devsmind project at
`c:/work 2/devsmind` has it as a dependency — run scripts via `npx tsx` from
there) rather than guessing from file listings alone.

## Step 0 — Enumerate repos

Before anything else, list the exact 8 repo names as they appear in the graph
(node IDs are scoped `{repo}/...`; also check the `.devmind` config/repos
table). Use these exact names as the row keys for every breakdown below.

## The 5 checks

Run the following 5 checks. **Every check must be reported two ways: (a)
broken out per individual repo, for all 8 repos, and (b) as one
combined/aggregate score across the whole graph.** Don't collapse to just the
aggregate — the whole point is to see which specific repo(s) are dragging the
score down.

1. **Node extraction quality** — Stratify the sample across all 8 repos
   (don't just spread 20 files loosely — give each repo an independently
   meaningful subsample, minimum ~4 files per repo, ~32+ files total). For
   each file, compare its real line count and complexity against how many
   nodes were extracted and what types they got tagged. Flag any file that
   looks obviously under- or over-extracted. Score each repo 0–100, plus one
   aggregate 0–100.

2. **Graph folder integrity** — Scan every file in `graph/` for malformed
   nodes (missing id/name/type, empty strings, literal `"undefined"`),
   duplicate IDs within a file, and dangling connection references —
   tabulated per repo. Separately, diff the full set of node IDs in `graph/`
   against the full set of node IDs in `brain.db`, per repo and overall —
   report any mismatch in either direction and explain what caused it (don't
   just report the count). Score each repo 0–100, plus one aggregate 0–100.

3. **Node type consistency** — Check every active node's type against the
   taxonomy defined in `src/cli/runner.ts`'s `TAXONOMY_PROMPT`, per repo.
   Report the % conforming and every distinct off-taxonomy type found, per
   repo and in aggregate. Score each repo 0–100, plus one aggregate 0–100.

4. **Edge correctness** — Stratify the edge sample across repos (minimum ~5
   edges per repo, ~40–64 total from `node_connections`). For each, don't
   just check that the target name appears somewhere in the source file's
   text (weak proxy) — actually read the source file and confirm the calling
   relationship is real: the target must be referenced within the specific
   source function's own body, not just somewhere else in the same file. For
   anything wrong, identify the root cause in the resolver code (not just
   "this edge is bad"). Score each repo 0–100, plus one aggregate 0–100.

5. **Orphaned nodes** — Get the orphan count and rate per repo and overall.
   Stratify the orphan sample across repos (minimum ~5 per repo, ~50+ total)
   and, for each, grep the actual repo to determine if it's genuinely unused
   (dead code) versus a real false orphan (used elsewhere but the linker
   missed the edge). Report the dead-code vs false-orphan split per repo and
   in aggregate — not just a raw orphan percentage. Score each repo 0–100,
   plus one aggregate 0–100.

**Also, within checks 4 and 5:** break down orphan rate and edge density
(edges per node) by repo, and separately by backend vs frontend, to show
where problems concentrate.

## Root-causing

For every concrete defect found, trace it to the actual line of code
responsible (in `ast.ts`, `runner.ts`, or `database.ts`) — not just a
description of the symptom.

## Final deliverable

A scorecard table — rows = the 8 repos plus one "ALL REPOS (aggregate)" row;
columns = the 5 check scores plus one "Overall" column (a single 0–100 score
per row with a one-line justification). Follow the table with the detailed
per-check findings (root causes, off-taxonomy types, dead-code vs
false-orphan splits, etc.), organized per repo first, then aggregate.
