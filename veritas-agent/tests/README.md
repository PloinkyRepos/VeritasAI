# VeritasAI Test Suite

This directory contains an integration-style test harness that exercises the VeritasAI strategy layer and skills against a live LLM provider. The suite relies on `test_all.js`, which executes each test sequentially via a lightweight runner.

## Prerequisites

- Node.js 18 or later.
- Valid API credentials for at least one model configured in `ploinkyAgentLib` (for example `OPENAI_API_KEY`).  
  The library uses `LLMConfig.json` to decide which provider/model to call.
- Network access enabled for the process (the tests make real LLM calls).

## Running the Tests

```bash
node tests/test_all.js
```

If `OPENAI_API_KEY` is missing, the runner prompts for it at startup (interactive terminals only). The runner reports progress as it executes developer tests (direct assertions on the strategy implementation) followed by scenario tests for each skill. Failures surface detailed diagnostics, including the LLM evaluation feedback.

## Structure

- `test_all.js` – orchestrates the execution of every registered test.
- `utils/` – helpers for creating the `SimpleLLmStrategy`, instantiating the shared `LLMAgent`, LLM-based expectation checking, and reusable pharma fixtures.
- `strategy/` – developer tests focused on `SimpleLLmStrategy`.
- `skills/` – end-to-end style tests for each VeritasAI skill, seeded with pharmaceutical compliance examples.

Each test runs with an isolated knowledge store under `tests/.tmp/`. You can delete the directory at any time if you need a fresh start.
