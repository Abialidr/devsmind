# DevsMind — Next Core Features Roadmap

This document outlines the evaluation, prioritization, and specifications of future growth areas for the DevsMind Team AI Brain platform, based on real agent feedback and developer observation.

---

## 📊 Core Feature Roadmap & Prioritization

We have categorized future enhancements into actionable phases based on implementation complexity and value added to both human developers and AI coding agents.

### Phase 1: Quick Wins & Semantic Analysis (Current Focus)

#### 1. Graph Health Analytics (`analyze_graph`)
*   **Goal**: Run structural analysis algorithms over the existing SQLite graph.
*   **Metrics & Detections**:
    *   **God Entities**: Detect nodes with more than 15 callers/dependencies (high coupling).
    *   **Circular References**: DFS-based circular dependency path tracer.
    *   **Orphaned History**: Stale nodes with history records but zero active code references.
*   **MCP Integration**: Introduce `analyze_graph` tool returning a JSON summary of code smells and architectural bottlenecks.

#### 2. Local Semantic Search (Hybrid FTS5 + Vector Embeddings)
*   **Goal**: Allow natural language search (e.g., *"where is OTP brute-forcing prevented?"*) rather than exact symbol matches.
*   **Implementation**:
    *   Integrate a lightweight vector library or SQLite extension (`sqlite-vss`).
    *   On `update_history`, compute code/reasoning embeddings using an API (Gemini/OpenAI) or local ONNX model and store in a `node_embeddings` table.

---

### Phase 2: Automatic Call Graph & Code Parsing

#### 3. Background AST Sync Parser (`ts-morph`)
*   **Goal**: Eliminate the manual calling of `add_node` and `add_connection` by the AI agent during development.
*   **Implementation**:
    *   Parse source directories continuously or run a trigger-based scan using the TypeScript compiler API/`ts-morph`.
    *   Statically resolve `import` statements, function declarations, class dependencies, and method invocations.
    *   Map relationships dynamically and populate the connection table automatically.

---

### Phase 3: Cross-Service Topology & CI Pipeline Diffing

#### 4. Cross-Repo Trace Mapping (HTTP / Event Tracing)
*   **Goal**: Trace logical flow across multiple repository directories (e.g., Frontend calling Backend REST endpoints, or Backend pushing SQS/Kafka events).
*   **Implementation**:
    *   Scan for REST/GraphQL API decorators (like `@Get()`, `@Post()`, `@Controller()`) in backend services.
    *   Match frontend fetch/axios URL structures or pub-sub handlers to link nodes across repositories.

#### 5. CI/CD Graph Diff Comments
*   **Goal**: Let developers see structural architectural impact directly on their Pull Requests.
*   **Implementation**:
    *   Create a GitHub Action running on PR branches.
    *   Compare the current PR graph against the target branch.
    *   Comment on the PR showing:
        *   Modified/deprecated nodes.
        *   Downstream callers that might be affected by signature changes.
        *   Stale documentation warnings.

---

## 📈 Impact Scorecard

| Category | Contribution | Rationale | Priority |
| :--- | :--- | :--- | :--- |
| **Noise Filtering** | **85%** | FTS5 and semantic search narrow candidates down to functional declarations instead of string grep noise. | High |
| **Code Navigation** | **95%** | Eliminates filesystem walking by jumping directly to entrypoints and routes. | Critical |
| **Automated Syncer** | **90%** | Moving from manual connection registration to automatic AST parsing saves agent tokens. | Critical |
| **Cross-Repo Links** | **75%** | Unlocks trace mappings in microservice topologies. | Medium |
