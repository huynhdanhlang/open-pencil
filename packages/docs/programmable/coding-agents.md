# Coding agents

The OpenPencil desktop app can use a coding agent you already have — Claude Code, Codex, or Gemini CLI — as its design agent. The agent runs on your computer with your own subscription and chooses its own model; OpenPencil starts it through the [Agent Client Protocol](https://agentclientprotocol.com/) when you send a message and gives it the canvas tools through OpenPencil's local [MCP server](./mcp-server).

Coding agents need the desktop app; the browser cannot start programs on your computer. They take only the **Design agent** role. Visual review, plan reviews, and fast background work need an API model, which guided setup can add for you.

## What you need

1. The [OpenPencil desktop app](https://github.com/open-pencil/open-pencil/releases/latest).
2. The agent's ACP program, installed globally (see each agent below).
3. OpenPencil's MCP server, installed globally. Use the version that matches your app:

   ```sh
   npm install -g @open-pencil/mcp
   ```

4. The agent signed in to your account with its own command-line tool.

Then open **Settings → AI & agents → Run guided setup**, choose the agent under **Coding agents on this computer**, and check that both the agent and the MCP server show as installed. **Check again** looks again after you install something.

### Let your agent set itself up

If you already use one of these agents in a terminal, guided setup can do the typing for you: press **Copy setup prompt** on the agent's card and paste the prompt into the agent. It asks the agent to install its ACP program and the MCP server, confirm both are on your `PATH`, and make sure you are signed in.

## Claude Code

```sh
npm install -g @agentclientprotocol/claude-agent-acp
```

Sign in by running `claude` and using `/login`. The ACP program uses the same account as Claude Code.

## Codex

```sh
npm install -g @zed-industries/codex-acp
```

Sign in with `codex login`.

## Gemini CLI

```sh
npm install -g @google/gemini-cli
```

Gemini CLI speaks ACP itself, so there is no separate program. Run `gemini` once and choose a sign-in method.

## Troubleshooting

- **Shown as not found after installing.** Apps started from the Dock or Start menu do not see every folder your terminal adds to `PATH`. OpenPencil also looks in common global folders for npm, Bun, Volta, mise, and Homebrew; if your package manager installs elsewhere, add that folder to your login shell's `PATH` and restart OpenPencil.
- **The agent starts but cannot edit the canvas.** The MCP server is missing or does not match the app version. Install the matching `@open-pencil/mcp` version and restart OpenPencil.
- **The agent asks you to sign in.** Sign in with the agent's own command-line tool as described above, then send your message again.
