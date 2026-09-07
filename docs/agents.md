# Agents

## `BaseAgent` vs `SimpleAgent`

- **`BaseAgent`** (`src/core/base-agent.ts`) is the real engine — the run loop, memory compaction, tool dispatch, token accounting. It requires you to bring your own `MCPClient` (and therefore your own `MCPServer`/connection), which is what gives you the choice of in-process, IPC, or WebSocket execution (see [MCP Architecture](./mcp-architecture.md)).
- **`SimpleAgent`** (`src/templates/simple.ts`) is a thin subclass that wires up an in-process `MCPConnection` + `MCPServer` + `MCPClient` for you from a flat `tools`/`skills` list. Use this unless you specifically need a different transport.
- **`AgentDefinition`** (`src/core/agent-definition.ts`) isn't an agent at all — it's a reusable *description* of one kind of agent (persona, skills, tools) with no runtime wiring, which `SwarmBase` instantiates as many plain `BaseAgent`s as it needs. See [Multi-agent](#multi-agent) below.

## `BaseAgent` constructor

```ts
new BaseAgent({
  instruction: string;
  safetyPolicies?: string;   // default: "" — see "Guardrail system prompt" below
  allowedTools: MCPTool<any>[];
  aiProvider: AIProvider | AgentProviderEntry[];   // see Providers doc
  mcpClient: MCPClient;
  skills?: Skill[];
  maxMemorizeToken?: number;   // default: derived from the main provider's contextWindow * safeUsageRatio
  initData?: {
    compactMemory: string;
    retiredMessages: Message[];   // complete, ever-appended history of retired messages — each Message carries its own usage/timestamp
    messagesCompact: Message[];   // the working context currently replayed to the provider every turn
  };
  features?: {
    executeProviderFromMCPTool?: boolean;   // default: false — see "executeProvider feature flag" below
  };
});
```

### Guardrail system prompt

`safetyPolicies` is a separate `role: "system"` message, sent as its own leading entry ahead of the regular system prompt (see [Instructions, skills, and memory](#instructions-skills-and-memory-in-the-system-prompt)) on every main-provider `chat()` call in the run loop. Keep house rules/guardrails here rather than folding them into `instruction`, since it's a separate, cache-stable prefix ahead of the rest of the system prompt.

It is **not** prepended on an `executeProvider` call (see below) — stuffing a policy paragraph ahead of a narrow, single-purpose call (e.g. "describe this image") measurably degrades that call's output, and not every registered provider role even accepts a `system` message the way the main LLM does. A pre-dispatch content-safety check is the intended replacement there; not implemented yet.

### `executeProvider` feature flag

A tool's `execute()` can reach a registered `AIProvider` directly via `mcp.executeProvider(toolCallId, type, input)` (see [Tools](./tools.md#mcpexecuteprovider--calling-a-provider-from-inside-a-tool)) — a bigger trust surface than a tool that only returns data to the model, since it lets a tool spend real provider calls (and, per the point above, without a guardrail system prompt ahead of them). It's off by default: `BaseAgent#executeProvider` throws immediately unless `features.executeProviderFromMCPTool` was set `true` on construction. This gates every role uniformly (`image-describer` included) — enable it once you're ready to trust the tools you've allowed with direct provider access. **Inside a swarm this moves up a level:** the swarm answers these calls out of its own provider set, so the flag that counts is `SwarmBaseProps.features` and a per-agent one no longer opens or closes this door — see [Swarm](./swarm.md#providers-a-tool-reaches-for).

`SimpleAgent`'s constructor is the same shape minus `mcpClient`/`allowedTools` (it builds those from `tools`), plus `tools?: MCPTool<any>[]` and `maxMemorizeToken` defaulting to `16000` instead of being derived. `safetyPolicies` and `features` pass straight through to the underlying `BaseAgent`.

Token accounting no longer lives in `initData` as separate counters — every `Message` carries its own `usage` (see [Token accounting](#token-accounting)), so `retiredMessages`/`messagesCompact` alone are enough to resume with full token history intact.

## The run loop

```ts
await agent.run(prompt: string, streamCallback?: StreamCallback): Promise<boolean>;
```

Each call to `run()`:

1. Pushes the user prompt onto the message history and emits it as a `role: "user"` stream chunk.
2. Sends `[system, ...history]` plus the full tool schema list to the main provider's `chat()`.
3. If the model requested tool calls, dispatches each one (via the `MCPClient` this agent was built with), pushes a `role: "tool"` message + stream chunk per result, and loops back to step 2.
4. Repeats until the model's turn produces no tool calls (or a tool marked `stopIterationAfterUsingThisTool` fired — see [Tools](./tools.md)).

If `run()` is called again while a previous call is still in flight, the new call is queued and resolves once the current run finishes (or times out after 4 minutes) — it does not run concurrently or interleave.

### Calling `run()` again mid-flight: prompt coalescing, not truncation

This is a deliberate design for absorbing multiple user prompts that arrive while the agent is still mid-turn (e.g. a chat UI where the user sends a couple of follow-up messages before the first reply lands) — not a bug, and nothing gets cut off mid-tool-call. The currently running loop iteration (one model turn plus all of that turn's tool dispatches) always finishes; only the *next* iteration is skipped once another `run()` call has queued:

- **One call queues up:** the in-flight run finishes its current iteration and stops there; the queued call then runs its own fresh loop from scratch, in a context that already contains everything the first run produced (including any pending tool results).
- **Multiple calls queue up:** every queued call except the last one has its prompt appended straight into history as a plain `role: "user"` message (with a matching stream chunk) and its own `run()` promise resolves immediately — no model turn is generated for that prompt specifically. The *last* queued call is the one that actually drives a real model turn, in a context that now includes every prompt that queued before it. The model's eventual reply addresses the whole accumulated batch at once, not each queued prompt individually.

Practical implication: don't treat an early queued call's resolved `run()` promise as "the model has now answered this prompt" — for anything but the last queued call, it only means the prompt was recorded. Drive replies off `streamCallback` if you need to know when the model has actually responded.

### The resolved boolean: "was my call the one that actually finished last?"

`run()` resolves to `true` only for the call whose own loop iteration was the one still executing when the agent finally went idle (no other `run()` call queued behind it in the meantime); every other call — including every non-last call in a queued batch (see above) and a call that itself got superseded by a later one arriving while it ran — resolves to `false`.

This matters for anything that should only happen exactly once — when the agent has truly gone idle — not once per overlapping `run()` call. A `console.log`/notification saying "agent finished" is a clear example: with several `run()` calls overlapping (a user firing off a couple of follow-ups before the first reply lands, or several callers hitting the same agent instance), every one of those calls eventually resolves — so logging on every resolution logs "finished" 2-3 times for what was really one continuous stretch of work, and the last one can land a noticeable delay after the others since it's the one that actually drove a full model turn. Gating on the resolved value being `true` instead fires exactly once, at the moment the agent actually has nothing left queued:

```ts
if (await agent.run(prompt, streamCallback)) {
    console.log("agent finished"); // fires exactly once, when the agent is genuinely idle
}
// without the check: could log "finished" 2-3 times, with the last one arriving
// minutes after the others if the final queued call drove a long tool-heavy turn
```

A `false` result isn't an error — it just means another `run()` call (either one already queued when yours was called, or one that queued while yours was executing) is the one that ended up driving the agent's final state, and that call is the one whose `true` you should be waiting on instead.

`safeStop()` requests the current run stop at the next safe point; it resolves once the loop has actually stopped, or rejects if it doesn't stop within 4 minutes. It does not interrupt an in-flight model call — that call is left to finish normally, and the loop stops right after.

`immediateStop()` requests the same stop but returns right away without waiting for confirmation, **and** aborts the in-flight `chat()` call to the main provider immediately — the underlying HTTP request is cancelled rather than left to run to completion, so no further output tokens get generated (and billed) past that point. Input tokens, and any output already generated before the abort landed, are already committed — cancelling can't retroactively make those free. This is the one to reach for when a call has to be killed regardless of how far through it is (e.g. a credit balance that just went negative). A tool dispatch already in progress isn't aborted (tools have no generic cancellation hook) — the loop stops as soon as that call returns. Abort support is real for Anthropic, OpenAI, and DeepSeek (both streaming and non-streaming); for Ollama it only takes effect on streaming calls — see the note in `ollama-provider.ts`.

If you're deciding *when* to call `immediateStop()` from outside — e.g. against an external credit/cost system — watch `usage` on the `StreamCallback` chunks (see [Streaming](./streaming.md)) rather than waiting for `run()` to resolve: it's the same callback passed into `run()`, forwarded straight through to the provider, so external code sees the same numbers `BaseAgent` itself uses to build `Message.usage`. Note this is only genuinely live for Anthropic — the other three providers only report usage once a turn is already complete, so for them there's no earlier signal to react to, cancellation-timing-wise, than the final chunk.

For a **streaming** call, an abort doesn't throw the turn away: `chat()` resolves normally with whatever text, thinking, and tool calls were already accumulated before the cutoff — the same as if the model had naturally stopped there — so anything already sent to `streamCallback` still ends up recorded in message history instead of vanishing. A tool call the model was still in the middle of generating when the abort hit is dropped even then (its arguments may be truncated JSON); only tool calls that had already fully finished are included — e.g. if the model requested 3 tool calls and the abort landed while the 3rd was still streaming, only the first 2 come back. For a **non-streaming** call there's nothing to salvage (the API only returns a response once, in full) — abort there still surfaces as a thrown error, and `BaseAgent` discards that turn entirely rather than recording a broken one.

`stop()` is a deprecated alias for `safeStop()` and will be removed in the 1.0.0 major release.

### Native tool-calling is required

`run()` throws immediately if the main provider's `getCapabilities().supportsTools` is `false`. There is no legacy JSON-in-text fallback in the main loop anymore — pick a provider/model combination (or pass `{ supportsTools: true }`) that supports native function calling.

## Memory compaction

OrbitX never truncates or deletes conversation history. Compaction happens through a real, always-available native tool — `compact_memory({ new_memory: string, continue_iterating?: boolean })` — that `BaseAgent` appends to every tool schema list alongside whatever MCP tools you allowed. This means the model can compact its own context whenever *it* judges the conversation has grown long, not only when forced to.

Calling `compact_memory`:

1. Replaces the running `compactMemory` string with `new_memory`, which is injected into every future system prompt (`MEMORY:` section). The cached system prompt is invalidated at the same time, so the very next turn's system prompt is rebuilt with the new summary rather than replaying the stale one.
2. Once every tool call in that turn has been dispatched and had its normal tool-response message appended to `messagesCompact` — `compact_memory`'s own response included — the *entire* turn's `messagesCompact` (the assistant message, every tool-response message, all of it) is moved into `retiredMessages` and `messagesCompact` is cleared. Nothing is lost, it's just retired from what gets replayed to the model every turn. Nothing needs to be separately "rolled into a lifetime total" — every message already carries its own `usage`, so `getFullTotalToken()` (see [Token accounting](#token-accounting)) just sums `retiredMessages` + `messagesCompact` directly.
3. A single hidden `role: "user"` message — `"Memory compacted. Continue where you left off, using MEMORY above for context."` — is pushed onto the now-empty `messagesCompact`, but *only if `run()` is actually about to take another turn right now* (see `continue_iterating` below for when it isn't). With nothing left to respond to it this turn, an unconditional push would just leave it sitting in `messagesCompact` as a stray, unanswered `"user"` entry until some later, unrelated user message showed up after it. When it is added, the model's next turn already has the new summary via the system prompt's MEMORY section, so nothing about the compacted turn — including the `compact_memory` call/response pair itself — needs to stay in the replayed working context; the message is just the nudge to keep going.

Archiving is deliberately deferred until the whole turn is dispatched, rather than happening the instant `compact_memory` itself resolves: providers reject a `"tool"`-role message that isn't preceded, in the same request, by the assistant message carrying the `tool_calls` it's answering, so archiving mid-turn would strand the response of any *other* tool call made alongside `compact_memory` in the same turn. Doing it once, after every call in the turn already has its response in `messagesCompact`, avoids that regardless of how many other tools were called or in what order.

Like the forced-compaction nudge below, this confirmation message (and its matching `StreamCallback` chunk) is marked `hidden: true` — see the note two paragraphs down.

### `continue_iterating`: letting the model opt out of the next round-trip

Every other tool call makes `run()`'s loop take another turn (call the provider again) once it's dispatched — that's the right default, since a normal tool call usually means the model still has work left to do. `compact_memory` is different: a model will often call it *after* it's already produced its final answer to the user this turn, purely to tidy up context for next time. Without a way to say so, that trailing `compact_memory` call would look just like any other tool call and force one more, otherwise pointless, provider round-trip before `run()` returns.

`continue_iterating` (optional boolean, defaults to `true`) is how the model avoids that: pass `false` when the compaction is happening after the user already has their answer and there's nothing else to do this turn. When `compact_memory` is the *only* tool called in a turn and `continue_iterating` is `false`, that call no longer counts toward `run()`'s decision to keep looping, and (per the note above) the hidden confirmation message is skipped entirely rather than left dangling — the turn ends and control returns to the caller right after archiving. If any other tool was called in the same turn, that other call still triggers the normal continuation regardless of `continue_iterating`, since something else clearly still needed a response — and in that case the confirmation message is still added, since there's a next turn for it to be read by.

Before each turn, `BaseAgent` also checks the current context size: the summed `inputMissTokens` of every message's `"main"` usage entry across `messagesCompact` (see [Token accounting](#token-accounting)) — a cheap proxy for context size, not a precise replay-cost measurement. When that sum exceeds `maxMemorizeToken`, the agent doesn't compact on the model's behalf — instead it appends a `role: "user"` message telling the model to call `compact_memory` before doing anything else, and loops back for another turn. This keeps compaction on the same native tool-call path the model already uses for everything else, rather than a side-channel the model never sees; a model that ignores the nudge (rare, since the instruction is explicit) will simply see it repeated on the next turn until it complies.

This nudge message (and its matching `StreamCallback` chunk) is marked `hidden: true`, since it's `BaseAgent` talking to the model on the caller's behalf, not something a human said or the model produced — a chat UI built on this SDK should filter it out of what it shows an end user, the same way it wouldn't show raw system-prompt text. See [Streaming](./streaming.md) for the full `Message`/chunk field reference.

The nudge's text explicitly tells the model how to decide `continue_iterating` on the `compact_memory` call it triggers: `true` if there's still unfinished work left from before the nudge fired (e.g. the model is mid-way through a multi-step task the user asked for), `false` if the user already had everything they needed. `run()` trusts that decision either way — it does **not** force `continue_iterating` to `false` just because the call is answering this internal nudge rather than a real user message. A compaction that happens mid-task (say, partway through a long sequence of tool calls the user asked for) needs to keep going exactly as much as a voluntary one does; only the model, not `run()`, knows whether that's the case.

`maxMemorizeToken`, if not passed explicitly, is derived as `contextWindow * safeUsageRatio` (default ratio `0.5`) from the main provider's `getCapabilities()` — so it scales automatically with whatever model you plug in.

## Persisting and resuming state

`getCurrentAgentStates()` returns exactly the shape expected by the `initData` constructor option — `compactMemory`, `retiredMessages`, `messagesCompact`. Serialize it (it's plain JSON) after any `run()` call, and pass it back into a fresh `BaseAgent`/`SimpleAgent` to resume — same conversation, same memory, same token history, since every message already carries its own `usage`. See the example in [Getting Started](./getting-started.md#recovering-an-agents-state).

A snapshot taken with an older SDK version, before per-message `usage` existed, still loads fine — messages with no `usage` field just contribute `0` to every token total below.

### History repair on load

Both `retiredMessages` and `messagesCompact` passed via `initData` are run through an internal repair pass before `BaseAgent` stores them. It drops any assistant `toolCalls` entry that has no matching `"tool"`-role message right after it, and any `"tool"`-role message that has no preceding assistant `toolCalls` entry to answer — the shape a provider rejects with a 400 the moment it's replayed. This can happen to a snapshot saved mid-run (e.g. the process was killed between dispatching a tool call and receiving its result) or one saved with an older SDK version that had the `compact_memory` pairing bug described above. Repair only removes orphaned tool-call/tool-result pairs; every other message, and all of `compactMemory`, is preserved as-is.

## Token accounting

Token usage lives on `Message.usage` (`MessageUsage[]`), not on separate counters — `BaseAgent` populates it as `chat()` responses come back, and the four read methods below are pure derived sums over `retiredMessages`/`messagesCompact`. There's no rollover bookkeeping to keep in sync on compaction (see [Memory compaction](#memory-compaction)): a message lives in exactly one of `retiredMessages` (retired) or `messagesCompact` (active) at a time — they're disjoint, not overlapping — so "already compacted away" is simply `retiredMessages` itself, with no slicing required. The complete history at any point is the concatenation of the two, in that order, not `retiredMessages` alone.

Each entry in `Message.usage` is one of:

```ts
{ type: ProviderType; model: string; unit: "tokens"; inputMissTokens: number; inputCacheTokens: number; outputTokens: number }
{ type: ProviderType; model: string; unit: "cost"; cost: number }
```

`type` is the provider role that produced the entry (see [Provider roles](./providers.md#provider-roles) — `"main"`, `"image-describer"`, or anything else registered/looked up). `model` is the concrete model that role resolved to for this particular call, exactly as the provider reports it from `getModel()` (e.g. `"deepseek-v4-flash"`, `"claude-sonnet-4-5"`) — the role says *what the call was for*, the model says *what actually answered it*, and one role can resolve to different models across a run (or across agents in a swarm), so a per-model breakdown is only possible because each entry carries its own. The read methods below still sum by `type`; filter `Message.usage` yourself when you want the split per model. `unit` distinguishes real token billing from anything that isn't naturally token-shaped — an image/audio/3D-generation call billed as a flat price reports `unit: "cost"` instead.

**Attribution** — a `type: "main"` entry is set only on the assistant message a `chat()` call produced, straight from that call's own `inputMissTokens`/`inputCacheTokens`/`outputTokens`. There's no splitting or attribution onto the user/tool messages that triggered the call, and no per-message context-size measurement — a user or tool message never carries a `"main"` entry. These are real, provider-reported numbers (Anthropic's `cache_read_input_tokens`/`cache_creation_input_tokens`, DeepSeek's `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`, OpenAI's `prompt_tokens_details.cached_tokens`), not a client-side guess — see [Providers](./providers.md) for what each one actually reports and Ollama's lack of any cache concept (`inputCacheTokens` always `0` there).

The compaction trigger (see [Memory compaction](#memory-compaction)) sums `inputMissTokens` across every assistant message's `"main"` entry in `messagesCompact` as a cheap proxy for context size — not a precise measurement of what replaying `messagesCompact` right now would actually cost, since each entry reflects the call that produced that one assistant message, not the whole context at that point.

Every other `type` entry comes from a tool calling `mcp.executeProvider(toolCallId, type, input)` (see [Tools](./tools.md#mcpexecuteprovider--calling-a-provider-from-inside-a-tool)) — but the entry itself is recorded by `BaseAgent`, the instant the real provider call resolves, never by the tool's own return value. This is deliberate: a tool can't under-report (or hide) what it spent, because it never holds the usage number to begin with — `BaseAgent` keys it by `toolCallId` and moves it onto that call's result `Message.usage` only after `execute()` returns, regardless of what the tool itself returns. `read-image`/`browser-screenshot`, for example, trigger a `type: "image-describer", unit: "tokens"` entry with no hit/miss split (each call is a fresh, standalone chat issued directly against the resolved provider by `BaseAgent`, so every input token counts as `inputMissTokens`). In a swarm the provider call is *answered* by `SwarmBase` (out of the swarm's provider set) but the usage is still recorded on the agent that made the tool call, through `BaseAgent.recordToolCallUsage(toolCallId, usage)` — same message, same guarantee, so agent totals stay truthful and the swarm's totals pick it up from there instead of counting it twice. See [Swarm](./swarm.md#providers-a-tool-reaches-for).

`executeProvider` picks `unit: "tokens"` vs `unit: "cost"` dynamically from what the provider's `ChatResponse` actually reported, rather than assuming one or the other: if the response set `cost` (a flat, non-token price — see [`ChatResponse`](./providers.md#writing-a-custom-provider)), the entry is `unit: "cost"`; otherwise it falls back to the token fields (`inputMissTokens`/`inputCacheTokens`/`outputTokens`, each defaulting to `0` if the provider omitted them). Every built-in provider (Anthropic/OpenAI/DeepSeek/Ollama) is token-billed and always takes the token path — `cost` only comes into play for a custom provider registered under an image/video/audio-generation-style role that bills per-request instead of per-token.

**The four read methods:**

- `getCompactTotalTokens(type: ProviderType)` / `getFullTotalToken(type: ProviderType)` — return `{ total, inputHit, inputMiss, output }`, summing `unit: "tokens"` entries matching `type` over `messagesCompact` only, or `retiredMessages` + `messagesCompact` (this agent's whole lifetime), respectively.
- `getCompactTotalCost(type: ProviderType)` / `getFullTotalCost(type: ProviderType)` — return a plain `number`, summing `unit: "cost"` entries matching `type` over the same two scopes.

## Instructions, skills, and memory in the system prompt

The system prompt is built lazily on first use and cached — a stable prefix between compactions, which matters for provider-side prompt caching. It's assembled from: a fixed "you have tools" preamble, each skill's name/description/instructions (see [Skills](./skills.md)), the current `MEMORY:` block (sourced from `compactMemory`), and your `instruction` string, in that order. Each `compact_memory` call invalidates the cache (see [Memory compaction](#memory-compaction)), so the next turn's system prompt is rebuilt with the fresh `MEMORY:` block instead of the one that was current when the prompt was first built.

## Multi-agent

Multiple agents that hire, task, and report to each other live in [Swarm](./swarm.md) — `SwarmBase`, `getAgentTools()`, and `AgentDefinition`.

The short version, since it changes nothing here: every agent in a swarm is an ordinary `BaseAgent` with an ordinary `allowedTools` list. `SwarmBase` owns the live agents and the wiring between them; the `agent-*` tools from `getAgentTools()` are the only way an agent reaches that wiring; and `AgentDefinition` is the `Skill`-shaped abstraction you write once and hand to a swarm rather than assembling `BaseAgentProps` per agent.

The one behavior worth knowing from this page's perspective: a swarm's `run()` resolves `true` only when *every* agent in it is idle, not when the entrypoint agent stops talking. A single `BaseAgent.run()` resolving is one agent's turn ending; a swarm's is the whole system settling.
