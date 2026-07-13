---
title: Durable Agent Memory
category: Agents
subcategory: Configuration
order: 6
description: Durable facts agents recall across conversations — personal, team, and org scope
---

<!--
Check ../docs_writer_prompt.md before changing this file.

This document is human-built, shouldn't be updated with AI. Don't change anything here.

Exception:
- Screenshot
-->

Durable agent memory stores short factual statements that agents can reuse across conversations. Unlike knowledge bases, memory entries are plain text facts — not documents, embeddings, or connectors.

## Memory Scopes

Memory exists at three scopes:

- **Personal** — facts about an individual user. Personal agents write here during chat; users can also browse and manage personal rows in **Settings → Memory**.
- **Team** — facts shared with one or more teams. Team agents write here for their assigned teams. If a team agent is assigned to multiple teams, one write fans out to each assigned team.
- **Org** — facts shared across the organization. Organization agents write here.

Agent writes follow the **agent's scope**, not a human-only workflow. Team and org memory are not manual-only.

## How Agents Use Memory

During chat, an agent with the `archestra__memory` tool can view, search, create, update, or delete durable memory.

**Write targeting** matches agent scope:

- Personal agents → personal memory for the chatting user
- Team agents → team memory for assigned teams
- Organization agents → org memory

**Shared writes** (team or org) require trusted chat context (not tainted by unsafe tool output) and **Allow shared memory writes** enabled on the agent (default on). That switch gates shared auto-save only — personal writes are not gated by it.

If context is untrusted, the tool refuses to save and directs the user to add the fact manually in **Settings → Memory**.

**Reads and injection** are narrower than writes: the chatting user's personal memory plus shared memory allowed by the agent's scope, then capped by team membership and the member's memory access level (below).

Each row records **provenance** — agent-authored vs manual — so operators can see what was saved during chat versus entered later in Settings.

## Agent Configuration

In the agent dialog:

- **Scope** — where the agent writes and which shared memory it reads: personal, team, or org
- **Allow shared memory writes** — whether team/org agents may auto-save shared facts during chat (personal always allowed when context is trusted)

Team-scoped agents only read and write team memory for teams assigned to that agent.

## Per-Member Memory Access

Memory admins set **Memory access** per member in **Settings → Users**:

| Level | Readable / injectable scopes |
|-------|------------------------------|
| Personal only | Personal |
| Team + personal | Personal + team |
| Organization | Personal + team + org |

Default is **Organization** (full access). This setting hides scope tabs the member cannot access and limits what shared memories can be searched or injected. It caps **read and injection**, not agent write targeting or write RBAC.

## Injecting Memory Into Prompts

Memory is **opt-in** in agent system prompts. Include the `{{memories}}` template variable where you want core memories injected. If the variable is omitted, no memory block is added to the prompt.

Archestra resolves it to up to **50 core memories total** across the scopes visible to the current user for that agent (scope-balanced: at least one from each non-empty visible scope, then newest overall). Only memories the user can read are eligible.

## Tiers

Each memory is **Core** or **Archival**:

- **Core** — eligible for prompt injection when `{{memories}}` is present. Up to 50 core memories **per scope** (personal, each team, org).
- **Archival** — kept for reference and search in Settings; never injected. Use **Archive** when a core slot is full or a fact should no longer influence agents.

There is no automatic expiry in v1. Archive or delete facts you no longer need.

## Managing Memory

Open **Settings → Memory** to browse facts by scope. The Team tab includes a team selector when you belong to multiple teams. Search and filter by tier, paginate long lists, and see a core count badge for the current scope.

The page is primarily for browse, correct, archive, promote, and delete. The **Source** column distinguishes **Agent** rows from manual fallback entries. Manual add remains available but is de-emphasized.

Scope tabs appear only when the member's access level includes that scope.

Organization admins can disable durable memory for the whole org from the banner on this page. Non-admins lose access until an admin re-enables it.
