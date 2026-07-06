# TT2Text Local Agent

The local agent is a macOS LaunchAgent that keeps the TT2Text Node server running at `http://localhost:3000/`.

The Chrome extension in `chrome-extension/` handles authenticated browser collection for Sensor Tower and TikTok pages. The local agent handles the local API, queue, transcription, translation, and data storage.

## Install

Double-click from Finder:

```text
install-agent.command
```

or run from Terminal:

```bash
npm run agent:install
```

This writes:

```text
~/Library/LaunchAgents/com.tt2text.agent.plist
```

and starts the local service immediately.

## Chrome Extension

Open Chrome extensions:

```bash
npm run agent:open
```

Then load or reload the unpacked extension directory:

```text
./chrome-extension
```

## Useful Commands

```bash
npm run agent:status
npm run agent:restart
npm run agent:stop
npm run agent:uninstall
```

Finder-friendly command files are also available in the project root:

```text
install-agent.command
start-agent.command
stop-agent.command
uninstall-agent.command
```

Each `.command` file resolves the project directory from its own location, so the project can live in any folder.
