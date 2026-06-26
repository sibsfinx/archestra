---
title: Durable Agent Memory
category: Agents
subcategory: Configuration
order: 6
description: Short-lived facts agents can recall across conversations — personal, team, and org scope
---

<!--
Check ../docs_writer_prompt.md before changing this file.

This document is human-built, shouldn't be updated with AI. Don't change anything here.

Exception:
- Screenshot
-->

Durable agent memory stores short factual statements that agents can reuse in later conversations. Unlike knowledge bases, memory entries are plain text facts — not documents, embeddings, or connectors.

Memory is scoped in three levels:

- **Personal** — facts about an individual user. Agents write these through the built-in `archestra__memory` tool during chat. Users can also add, edit, or delete personal facts in **Settings → Memory**.
- **Team** — facts shared with a team. Only team admins (users with `memory:team-admin` who belong to the team) can manage them in the settings UI.
- **Org** — facts shared across the organization. Only organization admins (`memory:admin`) can manage them in the settings UI.

## How Agents Use Memory

During a conversation, an agent with the memory tool assigned can view, search, create, update, or delete **personal** memories on behalf of the signed-in user. The tool refuses to save facts from untrusted context (for example, raw tool output flagged as unsafe) and asks the user to add them manually in **Settings → Memory** instead.

Team and org memories are not written by the agent tool. They are authored by humans in the settings UI so shared facts stay deliberate and reviewed.

## Injecting Memory Into Prompts

Memory is **opt-in** in agent system prompts. Include the `{{memories}}` template variable where you want core memories injected. Archestra resolves it to the core personal, team, and org memories visible to the current user. If the variable is omitted, no memory block is added to the prompt.

## Managing Memory

Open **Settings → Memory** to browse facts by scope (Personal, Team, Org). The Team tab includes a team selector when you belong to multiple teams. Add facts with the input at the top of each tab; edit or delete existing rows when you have write access for that scope.
