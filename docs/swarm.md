# Swarm

A **swarm** is a group of `BaseAgent`s that hire, task, and report to each other, behind a single entrypoint agent you talk to.

Nothing about `BaseAgent` changes to make this work. Every agent in a swarm is an ordinary `BaseAgent` with an ordinary `allowedTools` list. What makes it a swarm is two pieces:

- **`SwarmBase`** (`src/core/swarm-base.ts`) owns the live agents and the wiring between them.
- **`getAgentTools()`** (`src/tools/agent/`) builds the tools that are the only way an agent can reach that wiring.

Plus one supporting abstraction: **`AgentDefinition`** (`src/core/agent-definition.ts`), which is to agents what `Skill` is to instructions — a reusable, importable description of one kind of agent that you hand to a swarm instead of hand-writing a `BaseAgentProps` block per agent.

## Quick start

```ts
import {
  SwarmBase, getAgentTools, DefaultAgents,
  FsTools, BashTools, BrowserTools, TodoTools, UtilTools,
  AnthropicProvider,
} from "orbitx";

// Built once. The tools and the swarm share the state minted here.
const agentTools = getAgentTools({ maxHired: 5 });

// Everything this app can do. Each agent definition picks what its role needs.
const tools = [
  ...FsTools(), ...BashTools(), ...BrowserTools(), ...TodoTools(), ...UtilTools(),
  ...agentTools.tools,
];

const swarm = new SwarmBase({
  tools,
  agents: DefaultAgents(),      // [PlannerAgent, BackendAgent, FrontendAgent, ResearchAgent]
  default: "planner",           // which type is the entrypoint
  agentTools,
  aiProvider: new AnthropicProvider("claude-sonnet-4-5", process.env.ANTHROPIC_API_KEY!),
});

const done = await swarm.run("Build the checkout flow", chunk => {
  process.stdout.write(`[${chunk.agentId}] ${chunk.content}`);
});
// done === true → the planner is finished AND every agent it hired is idle
```

`SwarmBase` built its own `MCPConnection` + `MCPServer` + `MCPClient` here and registered every tool it knows about — the `SimpleAgent` treatment. Pass your own `mcpClient` instead if you need a different transport; then registering tools on it is your job.

## `AgentDefinition`

A definition is data, not a live agent: a swarm may instantiate the same definition three times. It carries the persona and the tools, and **no runtime wiring** — provider and MCP client come from the swarm.

```ts
new AgentDefinition({
  type: string;              // unique in a roster; the name a model passes to agent-hire
  description: string;       // what this agent is good at — written for the hiring model, not for humans
  rating?: Record<string, number>;   // per-task fit score, e.g. { backend: 10, frontend: 2 }
  instruction: string;
  safetyPolicies?: string;
  tools: MCPTool[];          // already narrowed out of the app's pool — see selectTools()
  skills?: Skill[];          // their tools are merged into allowedTools automatically
  aiProvider?: AgentProvidersInput;   // optional: pins a provider for this type only
  maxMemorizeToken?: number;
  features?: { executeProviderFromMCPTool?: boolean };
})
```

Methods: `getDefinition()`, `getType()`, `with(overrides)` (returns a **new** definition — never mutates), `getAllTools()` (own tools + skill tools), and `buildProps(runtime)` (the `BaseAgentProps` the swarm constructs from).

Note there is no `default` flag here. Which type is the entrypoint is the *swarm's* decision (`SwarmBaseProps.default`), because the same imported definition is an entrypoint in one swarm and a hireable worker in another.

### `selectTools(pool, names)`

A definition picks its tools out of the pool the app constructed, by exact name or trailing-`*` prefix:

```ts
tools: selectTools(pool, ["fs-*", "bash-*", "get-current-time", "agent-report-parent"])
```

Order follows `names`, duplicates are dropped, and a name with no match is **skipped rather than throwing** — the pool is the source of truth for what this app enabled, so an agent asking for a tool you don't ship simply doesn't get it.

This is also the capability gate. Since the whole swarm shares one MCP client, what an agent can do is decided entirely by what its definition picked: a definition that lists `agent-hire` can hire, one that lists `agent-report-parent` can report.

### Overrides

`AgentOverrides` can be applied by a factory's caller, or by the swarm — same merge either way:

```ts
type TextOverride =
  | string              // replace
  | { replace: string }
  | { append: string }
  | { prepend: string };

interface AgentOverrides {
  instruction?: TextOverride;
  safetyPolicies?: TextOverride;
  aiProvider?: AgentProvidersInput;
  maxMemorizeToken?: number;
  features?: { executeProviderFromMCPTool?: boolean };
  extraTools?: MCPTool[];    // appended to what the definition picked, deduped
}
```

A bare string replaces — predictable default. Instructions are usually appended (a definition is written once and reused, so a swarm normally adds project context rather than discarding the persona); safety policies are usually replaced.

```ts
new SwarmBase({
  // ...
  safetyPolicies: "Never touch files outside /workspace.",          // every agent
  instruction: { append: "This repo is a pnpm monorepo." },         // every agent
  overrides: {
    backend: {                                                       // this type only
      instruction: { append: "Postgres, not MySQL." },
      aiProvider: strongerProvider,
    },
  },
});
```

Merge order is **definition → swarm-wide → per-type**, so appends stack in that order.

## Ready-made agents (`src/agents/`)

| Export | Type | What it gets |
|---|---|---|
| `PlannerAgent` | `planner` | The hiring tools, todo tools, read-only filesystem. No write tools — a planner that can edit files starts doing the work itself. |
| `ReasonerAgent` | `reasoner` | `get-current-time`, `question-answer`, read-only filesystem, reporting tools. A six-persona panel that interrogates the user, then argues for a measured five minutes before answering. |
| `BackendAgent` | `backend` | `fs-*`, `bash-*`, reporting tools. Owns the API contract as a deliverable. Skills: node-backend, backend-security, code-verification. |
| `FrontendAgent` | `frontend` | `fs-*`, `bash-*`, `browser-*`, `read-image`, reporting tools. Built to work as one of several in a group. Skills: react-frontend, ui-ux-design, code-verification. |
| `TestAgent` | `tester` | `fs-*`, `bash-*`, `browser-*`, reporting tools. Verifies and reports; never fixes. Skills: code-verification, web-end-to-end-test. |
| `ResearchAgent` | `research` | `browser-*`, read-only filesystem, reporting tools. No write tools at all. Skill: research. |
| `DefaultAgents()` | — | All six, as a roster. |

They're ordinary factories with nothing privileged about them — copy one and change it. Each takes the app's pool and grabs what its role needs:

```ts
agents: [
  PlannerAgent,                                        // swarm calls it with its own `tools`
  BackendAgent({ tools, instruction: { append: "…" } }),  // or wire it yourself
  MyOwnAgent,
]
```

`PLANNER_PROTOCOL`, `WORKER_PROTOCOL`, `TEAM_PROTOCOL`, and `PRODUCTION_BAR` (`src/agents/protocol.ts`) are the shared text those definitions append to their own personas: how work arrives and where answers go, how several agents share one codebase without overwriting each other (`TEAM_PROTOCOL`), and what "finished" has to mean when the result is a real application rather than a demo (`PRODUCTION_BAR` — configuration from the environment, state that survives a restart, defined behaviour for every failure, nothing left stubbed, and the real build actually run). Import them into your own definitions, or ignore them. Nothing in `SwarmBase` depends on them.

### The build pipeline

`PlannerAgent`'s instruction carries an ordered pipeline, because the ordering is what keeps parallel agents from building against something nobody checked:

1. **Think.** Hire a `reasoner`, hand it the request, wait for its verdict. Its report is what the plan is made of. Fire it afterwards.
2. **Backend.** Hire a `backend` agent. Its task ends with two deliverables: working code, and an **API contract** written to a file — endpoints, request/response shapes, auth, errors.
3. **Verify the contract.** Hire a `tester` with that contract. It builds the backend, runs it, exercises every documented endpoint, and reports divergences. **The API docs do not reach any frontend until this passes** — a frontend built against a wrong contract is work paid for twice. Defects go back to the backend agent, then re-verify.
4. **Frontends, sized to the work.** One agent for a single screen, two for a handful, three for a large surface with independent sections. All hired into **one group**, each given the verified contract and its own slice.
5. **They scaffold by talking to each other.** Before writing code the group agrees on folder layout, routing, where shared code lives, and each agent claims its files by path — "I own `src/features/cart/`" — and never edits a file another agent claimed. That conversation runs over `agent-report-group`, without the planner in it. It's what stops three agents from creating three different project structures.
6. **Verify the whole thing.** A `tester` drives the finished UI in a real browser and checks that frontend and backend actually agree in practice.
7. **The planner answers the user** in its own words.

The reasoner's five minutes are wall clock, not vibes. It has no waiting tool — nothing to sleep on — so the time is filled with argument and measured as it goes: `get-current-time` before anyone speaks is T0, then **one persona speaks and one `get-current-time` follows it**, over and over, and the synthesis may not start until 300 seconds have actually passed.

That is one persona *per turn*: the persona's argument and the `get-current-time` call that ends it are a single assistant turn, and the next voice does not open its mouth until the timestamp has come back. The instruction says so in those terms because the tempting shortcut — writing all six personas in one burst and reading the clock once at the end — measures nothing. Six voices and one timestamp is a single block of text with a clock reading taped to it, not five minutes of argument, so the panel would report a number it never actually spent.

Timestamping after every persona rather than at the end of a round is what makes the pacing work. How many rounds fit inside five minutes is not a number the panel picks — it falls out of how fast the provider is answering, so a fast model gets more rounds and a slow one fewer, and both spend the same five minutes thinking. Checking the clock between voices tells the panel whether it has four rounds left to fill or is on its last one, so it argues at the right depth instead of discovering at the end that it rushed or overran. A ten-round cap keeps a very fast provider from looping past the point where rounds repeat rather than deepen.

Two things are deliberately excluded from that clock: the question phase before it (`question-answer`, no time limit — the panel interrogates the user until every persona can reason properly) and any mid-debate pause for the user, which is timestamped on both sides and subtracted, so waiting on a human never eats the five minutes.

Early agreement is explicitly treated as a signal to attack the consensus rather than permission to stop — that's the failure mode a panel exists to prevent. `REASONER_PANEL_MS` is exported if you want the number.

None of this is enforced by `SwarmBase` — it's instruction text in one definition. Replace `PlannerAgent` with your own and the swarm follows whatever pipeline you write instead.

### Telling a paused agent from a dead one

An agent's turn ends every time it stops generating, and that is not the same as being finished. The clearest case is a tool with `stopIterationAfterUsingThisTool` that waits on something outside the swarm — `question-answer` is exactly this: the agent asks, its turn ends on purpose, and it sits there until the answer arrives.

From a parent's side that used to be indistinguishable from a child that had crashed, because `busy` alone cannot tell them apart. The parent's usual reaction — re-task it, or fire it and route the work elsewhere — is the worst possible one: a second task lands on top of the first and comes back instead of the work you wanted, and firing throws away everything the agent has done *including the question it is waiting on*, which then never gets answered.

So `SwarmAgentInfo` carries a second flag. `awaitingReport` is set the moment a parent tasks an agent and cleared when that agent reports back (or fails, or is fired). Group messages are peer chatter and leave it alone. Read together:

| `busy` | `awaitingReport` | What it means |
|---|---|---|
| `true` | `true` | Working on your task right now. |
| `false` | `true` | **Tasked, paused, still owes you an answer** — blocked on something outside the swarm, most often a question put to the user. Leave it alone. |
| `false` | `false` | Idle, owes you nothing. |
| `true` | `false` | Running something that did not come from you — its own follow-up, or a group message. |

`agent-active` surfaces both, and `PLANNER_PROTOCOL` spells out the rule they exist to support: when an agent is paused, do not re-prompt it, do not fire it, do not poll it, and do not decide it failed — a real failure arrives as an explicit failure message naming the agent, so silence is never failure. Dispatch anything that doesn't depend on it, then end your turn; its report will wake you.

### Answering an agent's questions from your app

`question-answer` deliberately does nothing. Its `execute` returns immediately and its only real effect is `stopIterationAfterUsingThisTool`, which parks the agent. Actually reaching a human is the **host application's** job, not the library's — the library has no idea whether "the user" is a terminal, a web session, or a Slack thread.

Register it on the **client**, not in the sandbox: an agent inside a container has nobody to ask.

```ts
const hostTools = [...QuestionAnswerTools()];
const tools = [...sandboxTools, ...agentTools.tools, ...hostTools];

const mcpClient = new MCPClient("SWARM_ENV", computer.getConnection());
[...agentTools.tools, ...hostTools].forEach(tool => mcpClient.registerTool(tool));
```

Then watch the stream for the call, and use `run(answers, { agentId })` to wake exactly the agent that asked:

```ts
const pendingAsks: { agentId: string; questions: any[] }[] = [];

const render: SwarmStreamCallback = chunk => {
  for (const call of chunk.toolCalls ?? []) {
    if (call.name === "question-answer") {
      pendingAsks.push({ agentId: chunk.agentId, questions: call.inputs.questions ?? [] });
    }
  }
  // …your normal rendering…
};

let done = await swarm.run(task, render);

// `run` resolves when nothing is generating — which is also true of a swarm parked
// on a question nobody answered. "Idle" only means finished once there is nothing
// left to ask, and an answer can produce more questions.
while (pendingAsks.length) {
  const ask = pendingAsks.shift()!;
  const answers = await askYourUserSomehow(ask);           // terminal, HTTP, socket…
  done = await swarm.run(answers, { agentId: ask.agentId, stream: render });
}
```

Two things worth keeping in mind. `run()` returning `true` means *nothing is generating*, which a parked swarm also satisfies — so treat a non-empty question queue as "not finished" regardless of what `run` returned. And answer one agent at a time: waking an agent runs its work, and anything that work sets off, to quiet again before you look at the queue afresh.

See [`src/test.ts`](../src/test.ts) for a complete terminal implementation, including numbered `predefinedAnswer` shortcuts.

## `getAgentTools(options?)`

Returns a **handle**, not an `MCPTool[]`:

```ts
interface AgentToolsHandle {
  readonly tools: MCPTool[];             // into your pool, and onto your MCP server
  readonly id: string;
  getMaxHired(): number | undefined;
  attach(swarm: SwarmController): void;  // lets the tools read the roster
  on(event, listener): void;             // what the tools ask the swarm to do
  runAs(agentId, fn): Promise<T>;        // labels an agent's turn
}
```

The handle goes two places: `handle.tools` into the tool pool, and the handle itself into `new SwarmBase({ agentTools })`. Both halves share the state minted at construction, which is what makes `maxHired` a single pool rather than a per-agent allowance. Every call builds an independent handle, so two swarms in one process never share hire state — and attaching one handle to two swarms throws.

The last three are the seam between the tools and the swarm, and `SwarmBase` is the only thing that calls them — see [How it works under the hood](#how-it-works-under-the-hood).

| Tool | Who holds it | What it does |
|---|---|---|
| `agent-types` | hiring agents | Lists hireable types with description, ratings, how many of each are working, and remaining hire slots. |
| `agent-hire` | hiring agents | Spawns an agent of a type. Optional `group` and `briefing` (appended to that instance's standing instruction). Caller becomes its parent. |
| `agent-fire` | hiring agents | Releases one of your own hires and frees its slot. Stops it if it's mid-run. |
| `agent-active` | hiring agents | Every hired agent in the swarm — id, type, groups, parent, `busy`, `awaitingReport` — with `yours` marking your own. See [Telling a paused agent from a dead one](#telling-a-paused-agent-from-a-dead-one). |
| `agent-prompt` | hiring agents | Hands a task to one of your hires and **returns immediately**. |
| `agent-report-parent` | workers | Sends a result to the agent that hired you. Ends your turn (`stopIterationAfterUsingThisTool`). |
| `agent-report-group` | workers | Sends a message to every other agent in your group. Does **not** end your turn. |

When `maxHired` is set it's woven into `agent-hire`'s own description, so the model learns the constraint from the tool rather than out-of-band instructions.

## `SwarmBase`

```ts
new SwarmBase({
  tools?: MCPTool[];                     // the pool; handed to bare factories in `agents`
  agents: (AgentDefinition | AgentFactory)[];
  default: string;                       // type name of the entrypoint
  agentTools?: AgentToolsHandle;

  aiProvider: AgentProvidersInput;
  mcpClient?: MCPClient;                 // shared by every agent; omit and the swarm builds one
  envID?: string;                        // for the client the swarm builds; default "SWARM"

  safetyPolicies?: TextOverride;         // every agent
  instruction?: TextOverride;            // every agent
  maxMemorizeToken?: number;
  features?: { executeProviderFromMCPTool?: boolean };   // gates executeProvider for the whole swarm
  overrides?: Record<string, AgentOverrides>;   // per type

  initData?: SwarmState;                 // resume — see below
})
```

### `run(prompt, options?)` — finishes when the *swarm* is idle

This is the part that differs most from a single agent.

Concurrency follows `BaseAgent`: several `run()` calls may be in flight at once, extra prompts are absorbed into the entrypoint's current turn, and those absorbed calls resolve `false` as soon as that turn ends. The newest call stays live.

Unlike a single agent, the live call **does not resolve when the planner stops talking**. It keeps waiting while any hired agent is working, while any report or group message is in flight, and while those deliveries wake the planner for more turns. It resolves `true` only when the entire swarm is idle: nothing running, nothing queued.

```ts
const done = await swarm.run("build the checkout flow");
// true  → the whole swarm settled
// false → a newer run() call superseded this one and now owns the finish
```

The second argument is either a stream callback or an options object:

```ts
interface SwarmRunOptions {
  agentId?: string;              // who receives the prompt; default: the entrypoint agent
  stream?: SwarmStreamCallback;
}

await swarm.run("build the checkout flow");                            // → the planner
await swarm.run("build it", chunk => { /* … */ });                     // → the planner, streamed
await swarm.run("why did you pick Redis?", { agentId: "backend-1" });   // → straight to that agent
```

`agentId` is how you talk to one agent inside the swarm without its parent in the middle. The prompt arrives as a plain **user** message — no `[task from …]` wrapper, because it isn't from another agent — and the call still waits for the whole swarm to settle, including anything that agent sets off (a report waking its parent, for instance). Naming an agent that was fired, or one that never existed, throws.

Which call is "newest" is tracked by `SwarmBase` itself rather than read off `BaseAgent`'s return value, because the entrypoint also gets *internal* runs — every report delivered to it is one. Those must not demote the caller waiting on the swarm; only another `run()` does.

Practical consequence for planner instructions: **after dispatching work, the planner should stop and end its turn.** It isn't finished — reports arrive as new messages and wake it back up. Waiting in place just burns tokens. This is what `PLANNER_PROTOCOL` tells it.

### Streaming

Every chunk is a normal `StreamCallback` chunk plus `agentId`:

```ts
await swarm.run(prompt, chunk => {
  console.log(chunk.agentId, chunk.role, chunk.content);
});
```

Subscribers are live for the duration of a `run()` call and receive chunks from **every** agent, including ones a previous call hired — so a hired agent's output reaches whoever is listening now, not just the call that happened to start it.

### Groups and reports

- **Report to parent** (`agent-report-parent`) is the upward channel: a hire's answer to the agent that hired it. It ends the reporting agent's turn and lands in the parent's conversation as a new message, waking it if idle.
- **Report to group** (`agent-report-group`) is the sideways channel: one message to every other agent in the sender's group, and to nobody else. The parent does not see it. It does *not* end the sender's turn — sharing a finding with peers is something an agent does while working.

An agent joins a group when it's hired (`agent-hire`'s `group` input). Delivery in both directions is a push: the swarm calls `run()` on each target, and `BaseAgent`'s own queue merges the message if that agent is mid-turn.

Authority rules, enforced by the tools and surfaced as errors the model can act on:

- only the agent that hired someone can prompt or fire them
- the entrypoint agent can't be fired and holds no hire slot
- a fired agent can't be prompted, and its parent is told if a hire dies with an error instead of reporting

### Stopping

- `safeStop()` asks every **running** agent to stop at its next safe point, then waits for the swarm to go idle.
- `immediateStop()` aborts every in-flight provider call at once.

Both deliberately skip idle agents: `BaseAgent`'s stop signal is only cleared by its run loop, so signalling an agent that isn't running would either hang (`safeStop`) or silently swallow that agent's next run (`immediateStop`).

### Providers a tool reaches for

Some tools want a model of their own mid-call — `read-image` describing a picture, a browser screenshot being read. They ask for one by *role* through `mcp.executeProvider(toolCallId, type, input)`, and in a swarm **the swarm answers**, out of the whole provider set you gave it:

```ts
const swarm = new SwarmBase({
  // ...
  aiProvider: [
    { type: "main", provider: writer },
    { type: "image-describer", provider: vision },
  ],
  features: { executeProviderFromMCPTool: true },   // off by default
});
```

A standalone `BaseAgent` answers this itself, from its own providers. Inside a swarm it never does: the swarm takes the MCP client's handler back after building each agent, so every one of these calls lands on the swarm instead. That is deliberate, and it is what makes the whole thing simple — a tool asking for an image describer wants a model with that capability, not the model belonging to whichever agent happened to call it, so nothing has to work out who was calling.

Three things follow, and they are the trade:

- **`features.executeProviderFromMCPTool` is decided at swarm level.** Setting it on a definition or in `overrides` still governs that agent's own chat, but no longer whether its tools can reach a provider. The swarm's flag is the whole gate — there is no longer a "is this call yours" check behind it, because that check needed to know the caller.
- **A definition's own `aiProvider` doesn't apply here either.** Pinning a stronger model for the `backend` type changes what that agent thinks with, not what its tools reach for.
- **The usage still lands on the calling agent.** The swarm answers the call, but the tokens were spent for one agent's tool call, so `SwarmBase` records them there — `BaseAgent.recordToolCallUsage(toolCallId, usage)` puts the entry on that call's tool-result message, exactly where a standalone agent would put it. So `agent.getFullTotalToken(type)` includes it, and `swarm.getFullTotalToken(type)` / `getFullTotalCost(type)` pick it up by summing the agents rather than counting it a second time. The usage is written from the real provider result by the swarm, never from what the tool returned, so a tool still can't fake or hide what it spent. Only a call whose tool call is already gone (it outlived it) falls into the swarm's own bucket, so nothing is ever lost.

An unknown role, or one you never registered, comes back to the tool as `this swarm has no provider for type "…"` rather than silently falling back to `main`.

### State and resume

`getCurrentSwarmStates()` returns a `SwarmState` that round-trips straight back into `initData`:

```ts
interface SwarmState {
  default: string;              // id of the entrypoint agent
  agents: {
    id: string;
    type: string;
    parentId?: string;          // absent for the entrypoint
    groups: string[];
    state: AgentState;          // the BaseAgent state you already know
  }[];
}
```

```ts
const saved = swarm.getCurrentSwarmStates();
// …later, same roster, fresh getAgentTools() handle…
const resumed = new SwarmBase({ tools, agents, default: "planner", agentTools, aiProvider, initData: saved });
```

With `initData`, `initData.default` (an agent **id**) names the entrypoint instead of `default` (a type name). Agent ids are readable and stable (`backend-1`, `backend-2`) so a model can type them back into `agent-prompt`; the per-type counter continues from what was restored rather than colliding with it. A saved type that isn't in the roster, or a `default` that isn't in the saved agents, throws.

**Who was fired is deliberately not saved.** `active` is a fact about a running process, not about a conversation: a swarm that died left its agents mid-task with nobody waiting on them, so carrying "this one was let go" across a restart preserves a decision whose context is gone. What is worth keeping is what each agent said and remembered. Everything therefore comes back hired, and the entrypoint agent prompts or fires again from there.

### Reading the roster

| Method | Returns |
|---|---|
| `listAgents()` | Every agent — `agentId`, `type`, `parentId`, `groups`, `active`, `busy`, `awaitingReport`. Fired agents stay listed, with `active: false`. |
| `listTypes()` | Every hireable type with its description, ratings, and how many are working. |
| `getAgentInfo(id)` / `isEntrypoint(id)` | One row of the above, or whether an id is the entrypoint. |
| `getMainAgent()` / `getMainAgentId()` | The entrypoint `BaseAgent`, or its id. |
| `getAgent(id)` / `getAgentIds()` | One live agent, or every id. |
| `getFailures()` | Background failures — a hired agent that threw mid-task never surfaces through `run()`'s return value. |
| `getFullTotalToken(type)` / `getFullTotalCost(type)` | Usage summed across every agent, including fired ones — the swarm's whole bill for that provider role. |
| `getMCPClient()` / `ownsMCP()` | The shared client, and whether the swarm built it. |
| `close()` | Closes the connection the swarm built. No-op when you supplied the client. |

`createAgent`, `deactivateAgent` and `sendTo` are public too, but they are only what the event handlers call — raw state changes with no permission checks, no hire limit, and no message framing. Prefer the tools; reach for these only if you are writing your own tool layer.

There is deliberately **no** `hire()`, `fire()`, `prompt()` or `report()` on `SwarmBase`. Hiring and firing are decisions an agent makes, and the only way to make them is to call the matching tool — which is why every rule about who may do what lives in `src/tools/agent/` and not in the swarm.

## Running a swarm in a sandbox

Agents that write files and run shell commands are exactly what [`MCPComputer`](./mcp-architecture.md#mcpcomputer-sandboxed-execution) is for. Because the whole swarm shares one client, sandboxing all of it is just a matter of pointing that client at the container:

```ts
const computer = new MCPComputer("./data/test_swarm", [3000, 5173]);
await computer.start();

const agentTools = getAgentTools({ maxHired: 5 });

// The container has its own copies of these registered on the MCPServer running
// inside it. Locally these instances only carry names, for selectTools()/allowedTools.
const tools = [
  ...FsTools(), ...BashTools(), ...BrowserTools(), ...TodoTools(), ...UtilTools(),
  ...agentTools.tools,
];

const mcpClient = new MCPClient("SWARM_ENV", computer.getConnection());
// The agent tools drive this swarm, so they run here — not across the sandbox boundary.
agentTools.tools.forEach(tool => mcpClient.registerTool(tool));

const swarm = new SwarmBase({
  tools,
  agents: DefaultAgents(),
  default: "planner",
  agentTools,
  mcpClient,
  aiProvider,
  instruction: { append: computer.getInstructions() },
});

// …later
swarm.close();
await computer.stop();
```

Four things make that work:

- **Tools route by name.** `MCPClient.callTool` checks its own registered tools first and otherwise asks its connections, so `fs-write-file` lands inside the container while `agent-hire` runs in this process. The local `FsTools()` instances are never executed here.
- **Agent tools must stay client-side.** They drive the live swarm — spawning agents, delivering messages — which only exists in the host process. Registering them on the client is also the cheap path for anything that doesn't need isolation (see [`MCPClient`](./mcp-architecture.md#mcpclient)).
- **You register the tools yourself.** Passing your own `mcpClient` means `SwarmBase` registers nothing — that's the trade for controlling the transport.
- **`computer.getInstructions()` appended swarm-wide** tells every agent where the workspace, presents, and open ports are, without any definition needing to know it might be sandboxed. This is what swarm-level `instruction: { append }` is for.

Needs Docker running and the `orbitx-sandbox:0.1` image built from `Dockerfile.sandbox`.

## How it works under the hood

Two implementation details are worth knowing, because they're what let all of this happen without touching `BaseAgent` or `MCPClient`, and without the swarm keeping a ledger of tool calls.

**The caller comes from the turn, not from the tool call.** One `MCPClient` is shared by the whole swarm, so a tool's `execute(envID, inputs, toolCallId, mcp)` gets nothing that says who called it — `envID` and `mcp` are the same for everyone. `SwarmBase` therefore runs each agent's turn inside an `AsyncLocalStorage` context holding that agent's id (`handle.runAs(agentId, …)`), and the tools read the caller straight off it. Parallel agents each get their own store, so two reports in flight at once can't be confused. Called outside any turn, a tool refuses instead of guessing.

**Tools decide, the swarm carries out.** The handle is an `EventEmitter`. A tool checks what its caller may do — parentage, the shared hire cap, group membership — writes the message the receiving agent will see, then asks the swarm for the one thing it cannot do itself:

```ts
// in the tool
await registry.request("agent-report-parent", agentId, { to: [parentId], message });

// in SwarmBase
agentTools.on("agent-report-parent", (agentId, { to, message }, done) => {
  for (const target of to) this.sendTo(target, message);
  done();                       // done(error) fails the tool call instead
});
```

`request()` resolves when the swarm acks, rejects with whatever error the swarm passes to `done`, and times out rather than leaving an agent waiting forever on a listener nobody registered. That is why `SwarmBase` has no `hire()`/`fire()`/`report()` of its own: it never decides any of it, it only spawns, deactivates, and delivers.

**The swarm takes the provider handler back.** `BaseAgent`'s constructor claims the shared client's `executeProvider` handler, which is right for an agent on its own and wrong in a swarm, so `SwarmBase` re-claims it immediately after every spawn. That is the whole mechanism — `BaseAgent`'s own handler is simply never reached while it belongs to a swarm. The one thing `BaseAgent` adds for this is `recordToolCallUsage(toolCallId, usage)` (with `hasActiveToolCall(toolCallId)` alongside it), which lets the swarm write the usage back onto the tool call that spent it. See [Providers a tool reaches for](#providers-a-tool-reaches-for).

## Writing your own definition

```ts
import { AgentDefinition, selectTools, WORKER_PROTOCOL } from "orbitx";
import type { AgentFactory, AgentFactoryOptions } from "orbitx";

export const DataAgent: AgentFactory = ({ tools = [], ...overrides }: AgentFactoryOptions = {}) =>
  new AgentDefinition({
    type: "data",
    description: "Analytics and data modelling: schemas, migrations, query performance, reporting pipelines.",
    rating: { data: 10, backend: 6, frontend: 1 },
    skills: [MyDataSkill()],
    tools: selectTools(tools, ["fs-*", "bash-*", "agent-report-parent", "agent-report-group"]),
    instruction: `You are a data engineer working inside a swarm.\n\n…\n\n${WORKER_PROTOCOL}`,
  }).with(overrides);
```

Then drop it in the roster: `agents: [PlannerAgent, DataAgent]`. The `.with(overrides)` at the end is what makes your factory accept the same instruction/policy/provider overrides as the shipped ones.
