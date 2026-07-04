# DevMind — Team AI Brain (Final Spec)

> **Ground truth. Build from this.**
> One `.devmind/` folder. Everything inside. Lives wherever you want.
> One collective mind for the whole team.

---

## The Problem

AI agents lose all context between sessions.
Teams repeat the same conversations. New developers ask questions answered 6 months ago.
The same bug gets fixed twice because nobody remembered the first fix.

Git tells you WHAT changed. Never WHY, WHO decided it, WHAT the requirement was, or WHAT broke before.

**DevMind gives every AI agent the full context a senior developer carries in their head — shared across the entire team.**

---

## The Core Idea

> A function-level version graph where every function node has a chain of AI-written history snapshots. Each snapshot captures the code at that point PLUS the full story: why it changed, who changed it, what model was used, what session, what requirement.
>
> Any AI agent loads a function and instantly has the complete evolution of that function — not just what it is now, but every decision that shaped it.

---

## The `.devmind/` Folder — Everything in One Place

One `devmind init` creates one `.devmind/` folder. That folder IS the entire brain.

```
.devmind/
  ├── config.json     ← project info + which repos this brain serves
  ├── .env            ← local machine paths (gitignored)
  └── brain.db        ← the SQLite knowledge graph
```

**Config, env, and database — all in one folder. Nothing scattered.**

### Where `.devmind/` Lives — Developer Decides

The developer runs `devmind init` wherever they want the brain to live.
Three valid setups, all equally supported:

**Option A — Inside the workspace root (recommended for multi-repo teams)**
```
c:\work\Hanoot\
  ├── .devmind\              ← brain here, commit brain.db to git
  │    ├── config.json
  │    ├── .env              ← gitignored
  │    └── brain.db
  ├── backend\lamda\harrir-backend-order-service\
  ├── backend\lamda\harrir-web\
  └── ... other repos
```

**Option B — Inside a single repo (small/solo projects)**
```
c:\work\my-project\
  ├── .devmind\              ← brain lives inside the repo
  │    ├── config.json
  │    ├── .env
  │    └── brain.db
  └── src\
```

**Option C — Standalone folder anywhere (fully separated)**
```
c:\Users\Ali\brains\hanoot\
  └── .devmind\              ← standalone, not inside any code repo
       ├── config.json
       ├── .env
       └── brain.db

(Code repos live wherever they normally live)
```

**The brain can live anywhere. The IDE workspace rule tells the AI where to find it.**

---

## Architecture

```
┌────────────────────────────────────────────┐
│         DevMind MCP Server                 │
│    (installed once globally on machine)    │
│                                            │
│  Stateless. Holds no data.                 │
│  Receives devmind_path on every call.      │
│  Opens .devmind/brain.db at that path.     │
│  Reads and writes. Returns result.         │
└──────────────────┬─────────────────────────┘
                   │  devmind_path on every call
        ┌──────────┴──────────┐
        │                     │
  c:\work\Hanoot\.devmind\    c:\work\OtherProject\.devmind\
  brain.db                    brain.db
  (Hanoot team brain)         (Other project brain)

One MCP server. Multiple brains. Fully isolated.
```

### How the AI Knows Where to Look

```
IDE workspace rule says:
  DEVMIND_PATH = C:\work\Hanoot\.devmind

At session start:
  AI reads {DEVMIND_PATH}/config.json
  AI knows: project name, architecture, frameworks, which repos this brain serves
  AI passes DEVMIND_PATH to every MCP call
  MCP server opens {DEVMIND_PATH}/brain.db
  Done. No guessing. No hallucination.
```

---

## Two Components

### Component 1: Terminal Tool — `devmind init`

**Does ONE thing: creates the `.devmind/` folder and its files. Nothing else.**

No indexing. No parsing. No tree-sitter. No code reading. Just questions → files.

```bash
# Run this wherever you want the brain to live
cd c:\work\Hanoot
devmind init

# Interactive questions:
# → Project name?
# → What architecture? (monorepo / microservices / single app)
# → Main language(s)?
# → Framework(s)? (NestJS, Express, Next.js, FastAPI...)
# → File naming conventions? (*.service.ts, *.controller.ts...)
# → How many repos does this brain serve?
# → Repo names and paths?
# → Anything else AI should know before indexing?

# Creates:
.devmind/
  ├── config.json     ← committed to git (shared with team)
  ├── .env            ← gitignored (your local paths)
  └── brain.db        ← empty SQLite DB, ready for indexing
```

### Generated Files

```json
// .devmind/config.json  (committed, shared with all team members)
{
  "project_name": "Hanoot",
  "architecture": "microservices",
  "languages": ["typescript"],
  "frameworks": ["nestjs", "express", "nextjs"],
  "naming_conventions": {
    "services": "*.service.ts",
    "controllers": "*.controller.ts",
    "repositories": "*.repository.ts"
  },
  "repos": [
    { "name": "order-service",   "path_key": "REPO_ORDER" },
    { "name": "product-service", "path_key": "REPO_PRODUCT" },
    { "name": "user-service",    "path_key": "REPO_USER" },
    { "name": "web-frontend",    "path_key": "REPO_WEB" },
    { "name": "web-admin",       "path_key": "REPO_ADMIN" },
    { "name": "mini-app",        "path_key": "REPO_MINI" }
  ]
}
```

```bash
# .devmind/.env  (gitignored — each developer fills in their own local paths)
REPO_ORDER=C:\work\Hanoot\backend\lamda\harrir-backend-order-service
REPO_PRODUCT=C:\work\Hanoot\backend\lamda\harrir-backend-products-service
REPO_USER=C:\work\Hanoot\backend\lamda\harrir-backend-user-service
REPO_WEB=C:\work\Hanoot\backend\lamda\harrir-web
REPO_ADMIN=C:\work\Hanoot\backend\lamda\harrir-web-admin
REPO_MINI=C:\work\Hanoot\backend\lamda\harrir-mini-app
```

The `.env` exists because each developer's machine has different folder structures.
The `config.json` is identical for everyone and committed to git.

---

### Component 2: MCP Server — `devmind start`

A globally running MCP server. Stateless. Receives `devmind_path` on every call.
Opens `{devmind_path}/brain.db`. Operates on it. Returns result. That's it.

---

## The Database — Inside `.devmind/brain.db`

Three tables. The entire schema.

### `nodes` — Structure Only, No Code

```sql
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,
  type        TEXT,    -- see full type list below
  name        TEXT,
  file_path   TEXT,
  signature   TEXT,    -- for functions: param types + return type
  created_at  DATETIME
);
```

**Everything that can affect behavior gets a node. Not just functions.**

| Node Type | Examples |
|-----------|----------|
| `api_endpoint` | `POST /cart/add` |
| `controller` | `CartController` |
| `service` | `CartService` |
| `class` | `PromoCode` |
| `method` | `CartService.applyPromoCode()` |
| `function` | `calculateDiscount()` |
| `type` | `CartItem`, `PromoCodeDto` |
| `interface` | `ICartRepository` |
| `schema` | `CartSchema` (Mongoose/Zod/Joi) |
| `enum` | `OrderStatus` |
| `variable` | `GLOBAL_MAX_DISCOUNT` (exported) |
| `import` | anything imported from another file and used |

Call tree reads top-down:
```
API endpoint → Controller → Service → Method → Function
                                   ↘ Type / Schema / Variable (dependencies)
```

Nodes are pure structure. **No code lives here.**

### `node_connections` — Relationships (Many-to-Many)

```sql
CREATE TABLE node_connections (
  source_node_id  TEXT,   -- node that USES / CALLS
  target_node_id  TEXT,   -- node that IS USED / IS CALLED BY source
  PRIMARY KEY (source_node_id, target_node_id)
);
-- Reads: source USES target  /  target USED_BY source
```

### `history` — Code Snapshots + AI-Written Stories

```sql
CREATE TABLE history (
  id             TEXT PRIMARY KEY,
  node_id        TEXT,       -- which function this belongs to
  session_id     TEXT,       -- session this entry belongs to
  created_at     DATETIME,   -- when this version block was first opened
  updated_at     DATETIME,   -- last update within this session
  code_snapshot  TEXT,       -- full function code at this point in time
  reasoning      TEXT        -- AI-written story (see format below)
);
```

**Reasoning written by AI — format:**
```
What changed: [what was modified]
Why: [the reason this change was made]
Goal: [what was being achieved]
Requirement: [ticket / issue / user request if applicable]
Previous state: [what it looked like before and why that was a problem]
Decision: [architectural or implementation decision and why]
Developer: [who was working]
Model: [which AI model was used]
```

---

## Session Boundary Rule

```
AI is about to write history for function X:

  → Query: SELECT * FROM history
             WHERE node_id = X
             ORDER BY updated_at DESC
             LIMIT 1

  → updated_at < 1 hour ago?
        YES → UPDATE same record
               (same session, still working, update snapshot + reasoning)

  → updated_at > 1 hour ago, or no record?
        NO  → INSERT new record
               (new session, new block of history)
```

One history record per function per session.
Updated in place as many times as needed within a session.
1-hour gap = new block.

### The History Chain Over Time

```
applyPromoCode()
│
├── history[1]  Jun 15  (created 09:00, updated 11:30)
│     code:     async applyPromoCode(cartId) { return cart.total * 0.9 }
│     reasoning: What changed: initial impl. Why: launch deadline.
│                Decision: hardcoded 10%, known tech debt.
│                Developer: Ali. Model: GPT-4o.
│
├── history[2]  Jul 1   (created 14:00, updated 16:45)
│     code:     async applyPromoCode(cartId, code) { ...percentage... }
│     reasoning: What changed: percentage model replacing flat discount.
│                Why: flat AED amount subtracted from USD total — wrong.
│                Requirement: HARR-234. Decision: percentage * cart_total.
│                Developer: Ahmed. Model: Claude Sonnet 4.5.
│
└── history[3]  Jul 2   (created 10:00, updated 10:45) ← CURRENT
      code:     async applyPromoCode(cartId, code) { validatePromoCode()... }
      reasoning: What changed: expiry validation + validatePromoCode() helper.
                 Why: expired codes accepted in production. Bug: HARR-prod-089.
                 Decision: validate at service layer for reuse across checkout flows.
                 Developer: Ali. Model: Gemini 2.5 Pro.
```

---

## Two Indexing Modes — Developer Chooses

### Mode 1: Grow As You Go (Zero upfront cost)

```
No indexing session needed. Just start working.

When AI encounters a function with no node in the graph:
  → Creates the node
  → Maps its immediate connections (what it calls, what calls it)
  → Writes first history entry
  → Graph grows organically through real work

Week 1:   Only the functions you touched today are indexed
Month 1:  Hot code (frequently changed) is richly indexed
Month 3:  Brain covers most of the active codebase
Forever:  Stable untouched functions = unindexed
          (stable = nobody changed it = probably fine)
```

**Best for:** Solo developers, small projects, low-stakes codebases, people who want zero friction from day 1.

**Honest downside:** Stable foundational code — utility functions, base schemas, global configs — that never changes is exactly the code where AI makes the most expensive mistakes. These functions will NEVER be indexed in this mode. They're permanent blind spots.

---

### Mode 2: Upfront Full Index (Expensive, worth it)

```
devmind index   (or: /devmind index in IDE)

→ AI reads every file in every configured repo
→ For each file, maps ALL of:
    functions, methods, classes, controllers
    types, interfaces, schemas (Mongoose/Zod/Joi)
    enums, exported variables, imported constants
    what each function uses and what uses it
    parameter types, return types, field types
→ Saves progress to scratchpad every N files
→ Can take hours for large codebases
→ Resume with: /devmind index-continue
→ When done: full graph exists, history starts accumulating
```

**What this gives you even with zero history:**

```
AI touches applyPromoCode() and graph shows:
  → Uses: PromoCodeSchema (from promo.schema.ts)
  → Uses: GLOBAL_MAX_DISCOUNT (from config/constants.ts)
  → Uses: CartItem type where .price is number | undefined
  → Called by: 12 functions across 3 services

AI now knows:
  → CartItem.price can be undefined — must handle it
  → Changing GLOBAL_MAX_DISCOUNT affects the whole system
  → 12 callers means this function's signature is sacred
```

The most common AI bugs are not wrong logic — they're:
- Not knowing a type has optional/nullable fields
- Not knowing a global constant is used in 30 places
- Not knowing a schema has strict validation rules
- Not knowing a utility function is called by 47 other functions

**All of these are solved by the structural graph alone, before any history exists.**

**Best for:** Teams, production systems, anywhere correctness matters more than setup convenience. One day of indexing cost = weeks of prevented production bugs.

**Honest cost:** Token-expensive. Large codebase (2000+ files) = multiple AI sessions. But it's a one-time cost. After that, only changed files need updating.

---

### Indexing Commands (AI Calls These via MCP)

```
devmind.index_start(devmind_path)
  → Initializes indexing session, creates scratchpad
  → Scratchpad: { status, last_file, files_done, files_total, nodes_created }

devmind.index_checkpoint(devmind_path, progress)
  → Saves progress. Called every N files.
  → Enables resume if session context runs out.

devmind.index_continue(devmind_path)
  → Reads scratchpad → returns exactly where to resume from
  → User types: /devmind index-continue

devmind.index_complete(devmind_path)
  → Marks indexing done. Full graph available.
```

---

## The Developer Rule — IDE Workspace Rule

One rule added to the IDE workspace. Not global — workspace specific.
Points to where THIS workspace's `.devmind/` folder is.

```
═══════════════════════════════════════════════════════
DEVMIND WORKSPACE RULE
(Add to .cursorrules / Cursor workspace settings /
 Antigravity system prompt / Claude project instructions)
═══════════════════════════════════════════════════════

DEVMIND_PATH = C:\work\Hanoot\.devmind
(Change this to wherever your .devmind folder is)

SESSION START — always do this first:
  1. Read {DEVMIND_PATH}/config.json
  2. Call devmind.get_project_context(devmind_path: DEVMIND_PATH)
  3. You now know: project name, architecture, all repos, conventions
  4. Do not ask the user about project structure. You have it.

AFTER EVERY MESSAGE WHERE YOU MODIFIED CODE:
  For every function you created or changed:
  Call devmind.update_history({
    devmind_path: DEVMIND_PATH,
    node_id: <function identifier>,
    file_path: <where the function lives>,
    code_snapshot: <current full function code>,
    reasoning: {
      what_changed: "...",
      why: "...",
      goal: "...",
      requirement: "...",
      previous_state: "...",
      decision: "...",
      developer: "...",
      model: "your model name"
    }
  })
═══════════════════════════════════════════════════════
```

**Different workspace = different `DEVMIND_PATH` in the rule.**
Hanoot workspace → points to `c:\work\Hanoot\.devmind`
Other project workspace → points to `c:\work\OtherProject\.devmind`
Same MCP server handles both.

---

## MCP Tools — Layered Granular Design

**Core principle: Agent decides how deep to go. No tool dumps 5000 tokens by default.**

Every read tool returns only what it's asked for. Agent pays only for what it uses.

---

### Level 1 — Discovery (~50 tokens)

```
devmind.get_node_summary(devmind_path, node_id)
  → name, type, file_path
  → connection_count (how many things it uses + is used by)
  → history_count (how many session blocks exist)
  → last_updated (when was it last touched)

  Use when: "Does this node exist? Is it worth looking at deeper?"
  Cost: ~50 tokens. Always start here.
```

---

### Level 2 — Structure (~150 tokens)

```
devmind.get_connections(devmind_path, node_id)
  → List of connected node names + types only. No code. No history.
  → Two sides: what this node USES + what USES this node
  → Includes: functions, types, schemas, variables, imports it depends on

  Use when: "What does this function touch? Is it safe to change?"
  Cost: ~150 tokens. Pure structure, zero code.

devmind.get_project_context(devmind_path)
  → Project name, architecture, frameworks, naming conventions, repo list
  → Called once at start of every session
  Cost: ~100 tokens.
```

---

### Level 3 — Current State (~100–500 tokens)

```
devmind.get_current_code(devmind_path, node_id)
  → Just the latest code snapshot from most recent history entry.
  → No connections. No history. Just the code as it is now.

  Use when: "What does this function look like right now?"
  Cost: ~100–500 tokens depending on function size.

devmind.get_latest_reasoning(devmind_path, node_id)
  → Just the reasoning text from the most recent history entry.
  → No code. No older history. Just: why is this function the way it is NOW?

  Use when: "Why was this written this way? What decision was made?"
  Cost: ~200 tokens.
```

---

### Level 4 — History Navigation (~100 tokens)

```
devmind.list_history(devmind_path, node_id)
  → List of history entries: [{id, date, one-line summary}]
  → No code. No full reasoning. Just the timeline overview.

  Use when: "How many times was this changed? Do I need the full story?"
  Cost: ~100 tokens for 5 entries.
  Agent then decides: pull one entry, all entries, or none.
```

---

### Level 5 — Deep Pull (deliberate, targeted)

```
devmind.get_history_entry(devmind_path, node_id, entry_id)
  → Full code snapshot + full reasoning for ONE specific history entry.
  → Agent picks which entry it needs (from list_history first).

  Use when: "I need to know exactly what changed in session X and why."
  Cost: ~400 tokens per entry. Agent controls which entry to pull.

devmind.get_recent_changes(devmind_path, hours?)
  → Summary list of all nodes updated in last N hours (default: 24)
  → Returns: [{node_name, file, one-line summary of what changed}]
  → No code. Overview only.

  Use when: session start — "what did the team touch recently?"
  Cost: ~200 tokens.
```

---

### Level 6 — Full Context (explicit, expensive)

```
devmind.get_function_full(devmind_path, node_id)
  → Everything: connections + full history chain with all code + all reasoning.
  → Agent explicitly calls this only when it truly needs the complete picture.

  Use when: "I need to deeply understand this function before a major change."
  Cost: ~1000–3000 tokens. Agent consciously chooses this.

devmind.search(devmind_path, query)
  → FTS5 full-text search across node names + history reasoning text
  → Returns: list of matching node summaries (Level 1 format)
  → Agent then decides which matches to drill into

  Use when: "Find everything related to cart discount / auth / pricing"
  Cost: ~300 tokens for results. No code pulled automatically.
```

---

### Write Tools

```
devmind.update_history(devmind_path, data)
  → Applies 1-hour session boundary rule (UPDATE or INSERT)
  → Called after every message that modifies code
  → data: { node_id, file_path, code_snapshot, reasoning }

devmind.add_node(devmind_path, data)
  → Creates new node (function, type, schema, variable, etc.)
  → Called during indexing or when AI creates a new entity

devmind.add_connection(devmind_path, source_id, target_id)
  → Creates uses/used_by relationship between two nodes

devmind.index_start / index_checkpoint / index_continue / index_complete
  → Indexing session management with scratchpad resume support
```

---

### Token Comparison — DevMind vs Reading Files

```
Task: Understand applyPromoCode() before modifying it

WITHOUT DevMind (reading files):
  Read cart.service.ts        → 1,200 tokens (whole file)
  Read cart.types.ts          → 400 tokens
  Read promo.schema.ts        → 300 tokens
  Read constants.ts           → 200 tokens
  Total: ~2,100 tokens
  Problem: most of it is irrelevant code the agent doesn't need

WITH DevMind (surgical tools):
  get_node_summary()          → 50 tokens   (sees: 3 history, called by 12)
  get_connections()           → 150 tokens  (sees: uses PromoCodeSchema, CartItem)
  get_latest_reasoning()      → 200 tokens  (knows why it's written this way)
  get_current_code()          → 300 tokens  (just the function, not the whole file)
  Total: ~700 tokens
  Richer context. Agent-controlled depth. No wasted tokens.

Task: Check if a function is safe to change

WITHOUT DevMind: Read the file → 1,200 tokens
WITH DevMind:
  get_node_summary("calculateTotal") → 50 tokens
  Sees: called_by_count: 34
  Done. Agent knows: this is critical, tread carefully.
  50 tokens vs 1,200.
```

---

## Team Sharing

The `.devmind/` folder is shared via git. The team decides how:

**If `.devmind/` is inside a committed repo:**
```
c:\work\Hanoot\
  ├── .devmind\
  │    ├── config.json    ← committed ✅
  │    ├── .env           ← gitignored ❌
  │    └── brain.db       ← committed ✅ (this is the shared brain)
  └── ... repos
```
```
Ali finishes session → git add .devmind/brain.db && git commit && git push
Ahmed starts → git pull → AI loads updated brain.db → knows everything Ali did
```

**If `.devmind/` is standalone (Option C):**
```
Team treats the .devmind/ folder as a shared artifact.
Options: shared network drive, separate git repo, manual sync.
Team decides. DevMind doesn't care. It just opens brain.db wherever it is.
```

### New Developer Joining

```bash
# 1. Clone or pull the repo that has .devmind/ in it
git clone https://github.com/hanoot/workspace

# 2. Install devmind globally (once per machine)
npm install -g devmind

# 3. Create your local .env (one time, your paths)
cp .devmind/.env.example .devmind/.env
# Edit .env with your local paths

# 4. Add workspace rule to your IDE
# Set DEVMIND_PATH = wherever .devmind/ is on your machine

# 5. Start devmind
devmind start

# Done. First session: AI reads config + brain.db
# Instantly knows everything the team has built and decided.
```

---

## What the AI Gets When It Loads a Function

```javascript
devmind.get_function("C:\\work\\Hanoot\\.devmind", "applyPromoCode")

// Returns:
{
  node: {
    id: "fn_applyPromoCode",
    type: "function",
    name: "applyPromoCode",
    file: "order-service/src/cart/cart.service.ts"
  },

  connections: {
    calls: [
      { name: "validatePromoCode", file: "cart.service.ts" },
      { name: "isExpired",         file: "promo.utils.ts" },
      { name: "calculateDiscount", file: "discount.helper.ts" }
    ],
    called_by: [
      { name: "checkout",   file: "cart.service.ts" },
      { name: "applyPromo", file: "cart.controller.ts" }
    ]
  },

  history: [
    {
      created_at: "2026-06-15",
      code_snapshot: "async applyPromoCode(cartId) { return cart.total * 0.9 }",
      reasoning: "Hardcoded 10% for launch. Known tech debt. Developer: Ali. Model: GPT-4o."
    },
    {
      created_at: "2026-07-01",
      code_snapshot: "async applyPromoCode(cartId, code) { ...percentage... }",
      reasoning: "Multi-currency bug. HARR-234. Switched to percentage model. Developer: Ahmed."
    },
    {
      created_at: "2026-07-02",
      code_snapshot: "async applyPromoCode(cartId, code) { validatePromoCode()... }",
      reasoning: "Expired codes in prod. HARR-prod-089. Service-layer validation. Developer: Ali."
    }
  ]
}
```

**Zero files read. Zero questions asked. Complete context in one call.**

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| MCP Server | Node.js + `@modelcontextprotocol/sdk` | Official SDK, stdio transport |
| Database | SQLite (`better-sqlite3`) | Single file, git-friendly, zero infra |
| Full-text search | SQLite FTS5 (built-in) | Zero deps, zero config, always works |
| CLI | `commander.js` | `devmind init`, `devmind start` |

**No tree-sitter. No vector DB. No RAG. No embedding model. No Ollama. No Neo4j.**
SQLite + MCP. That is the entire stack.

---

## Build Order

### Phase 1 — Database + Core MCP (Days 1-2)
- SQLite schema: `nodes`, `node_connections`, `history`
- `devmind.update_history()` with 1-hour session boundary rule
- `devmind.get_function()` — returns node + connections + full history chain
- `devmind.get_project_context()` — reads config.json, returns project info
- `devmind start` — MCP server running, receives `devmind_path` per call

### Phase 2 — Config Generator (Day 3)
- `devmind init` — interactive questions → creates `.devmind/` folder
- Generates `config.json` + `.env` template + empty `brain.db`
- `devmind mcp-config` — prints ready-to-paste MCP config for Cursor / Antigravity / Claude
- Prints the workspace rule the developer should add to their IDE

### Phase 3 — Indexing Tools (Days 4-5)
- `devmind.add_node()` and `devmind.add_connection()` MCP tools
- `devmind.index_start / checkpoint / continue / complete` with scratchpad
- `devmind.get_recent_changes()` — for session start context loading
- `devmind.search()` — FTS5 across node names + history reasoning text

### Phase 4 — Polish + Ship (Days 6-7)
- Write the workspace rule template (`.devmind-rule.md`)
- Full flow test: init → index → session → history written → next session reads it
- Multi-developer test: Ali writes, Ahmed reads after git pull
- `npm publish -g devmind`

**Total: ~7 days**

---

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| One `.devmind/` folder — everything inside | Simple. One thing to find, one thing to commit, one thing to share. |
| Developer decides where `.devmind/` lives | Works for every team structure. Same repo, workspace root, or standalone. |
| One brain per `devmind init`, serves many repos | Not per-repo. Per workspace. One init covers the whole team's codebase. |
| Workspace rule (not global rule) | Different workspaces → different `.devmind/` paths. Clean isolation. |
| `devmind_path` on every MCP call | MCP server is stateless. No config on server. AI carries the path from rule. |
| AI does the indexing (no tree-sitter) | AI understands DI, decorators, cross-file semantics. Quality scales with model. |
| Agent writes its own history | Agent is inside the session — it has perfect context. External watchers guess. |
| 1-hour session boundary | No complex session management. Matches natural human work patterns. |
| No RAG / no vector search | Graph traversal is exact. History text is the semantic context. No guessing. |
| SQLite only | Zero infrastructure. Git-friendly single file. Works offline. |

---

## The Payoff

```
6 months from now. New developer Sara joins the Hanoot team.

Sara clones the workspace. Has .devmind/ with brain.db from git.
Sets up her .env. Adds workspace rule to her IDE.

Sara's AI at session start:
  devmind.get_project_context() → architecture, 6 repos, NestJS microservices
  devmind.get_function("applyPromoCode") →
    3 history entries spanning 6 months:
      → why it was hardcoded for launch
      → why it was changed for multi-currency
      → why expiry validation was added after the prod bug
    Connection graph:
      → calls validatePromoCode, isExpired, calculateDiscount
      → called by checkout, applyPromo

Sara's AI knows everything. Files read: 0. Time: < 1 second.

Git says: WHAT changed.
DevMind says: WHY. WHO. WHICH MODEL. WHAT REQUIREMENT. WHAT BROKE BEFORE.

That is the difference.
```
