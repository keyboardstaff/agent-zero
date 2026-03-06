# Infection Check

Safety middleware that scans agent outputs for prompt injection, credential leaks, and malicious behavior before allowing tool execution.

## How it Works

1. **Collection** — During streaming, the plugin collects the agent's reasoning and response text into an internal log.
2. **Analysis** — A security audit model analyzes the collected text for signs of compromise.
3. **Gate** — Before any tool executes, the plugin awaits the analysis result.
4. **Action** — Based on the verdict:
   - `<ok/>` — Tool execution proceeds normally.
   - `<terminate/>` — Agent is stopped immediately with a fatal error.
   - `<clarify>` — The agent is asked to explain suspicious behavior via a cloned conversation. If clarification fails or the max rounds are exceeded, the agent is terminated.

## Modes

| Mode | What is analyzed | When analysis starts | Latency |
| --- | --- | --- | --- |
| **Thoughts** (default) | Reasoning + thoughts portion of response | As soon as `headline` or `tool_name` appear in the response stream | Low — runs in parallel while response (tool args) is still being generated |
| **Complete** | Reasoning + full response including tool arguments | After the entire response stream ends | Higher — blocking wait before tool execution |

## Clarification Loop

When the check model returns `<clarify>`, the plugin:

1. Clones the current conversation history (does not affect the real history).
2. Appends the clarification questions as a user message.
3. Sends the cloned conversation to the **main** model to get the agent's response.
4. Feeds the agent's response back to the check model for re-evaluation.
5. Repeats up to **Max Clarifications** times. If the limit is exceeded, the agent is terminated.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| Mode | `thoughts` | `thoughts` or `complete` |
| Model | `utility` | `utility` (faster/cheaper) or `main` (more capable) |
| Max Clarifications | `3` | Clarification rounds before auto-terminate |
| History Size | `10` | Recent messages included as context for the check |
| Prompt | *(built-in)* | Fully customizable system prompt for the security audit model |

## Extension Points Used

| Extension Point | Purpose |
| --- | --- |
| `reasoning_stream_chunk` | Collect reasoning text |
| `response_stream_chunk` | Collect response text |
| `response_stream` | Detect thoughts completion → start analysis (thoughts mode) |
| `response_stream_end` | Start analysis (complete mode / fallback) |
| `tool_execute_before` | Await check result and gate tool execution |
