import { escapeHtml } from "./core/format.js";
import { formatCliName } from "./core/agent.js";
import { setStatus, showToast } from "./core/ui.js";

const agentRefreshButton = document.querySelector("#agent-refresh");
const agentServerStatus = document.querySelector("#agent-server-status");
const agentServerDetail = document.querySelector("#agent-server-detail");
const agentLaunchStatus = document.querySelector("#agent-launch-status");
const agentLaunchDetail = document.querySelector("#agent-launch-detail");
const agentCliList = document.querySelector("#agent-cli-list");
const agentCommandList = document.querySelector("#agent-command-list");
const agentLogPaths = document.querySelector("#agent-log-paths");
const statusEl = document.querySelector("#agent-page-status");
const toastEl = document.querySelector("#toast");

agentRefreshButton?.addEventListener("click", () => {
  loadAgentStatus();
});

async function loadAgentStatus() {
  agentRefreshButton.disabled = true;
  setStatus(statusEl, "正在刷新 agent 状态...");
  try {
    const response = await fetch("/api/agent/status");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "读取 Agent 状态失败");
    }
    renderAgentStatus(payload);
    setStatus(statusEl, "Agent 状态已刷新。");
  } catch (error) {
    agentServerStatus.textContent = "读取失败";
    agentServerDetail.textContent = error.message;
    agentLaunchStatus.textContent = "未知";
    agentLaunchDetail.textContent = "无法读取 LaunchAgent 状态。";
    agentCliList.innerHTML = "";
    agentCommandList.innerHTML = "";
    agentLogPaths.textContent = "暂无日志路径。";
    setStatus(statusEl, `刷新失败：${error.message}`);
  } finally {
    agentRefreshButton.disabled = false;
  }
}

  function renderAgentStatus(status) {
    agentServerStatus.textContent = status.localServer?.running ? "运行中" : "未运行";
    agentServerDetail.textContent = status.localServer?.running
      ? `${status.localServer.url} · pid ${status.localServer.pid}`
      : "本地服务未响应。";

    agentLaunchStatus.textContent = status.launchAgent?.loaded ? "已安装并加载" : "未加载";
    agentLaunchDetail.textContent = status.launchAgent?.loaded
      ? `label ${status.launchAgent.label}${status.launchAgent.pid ? ` · pid ${status.launchAgent.pid}` : ""}`
      : "还没有安装 LaunchAgent，或当前服务是手动启动。";

    renderAgentCommands(status.commands);
    agentLogPaths.textContent = formatAgentLogs(status.logs);
    renderAgentCliList(status.cli || {});
  }

  function renderAgentCommands(commands = {}) {
    agentCommandList.innerHTML = "";
    [
      ["安装", commands.install || "install-agent.command"],
      ["执行 / 启动", commands.start || "start-agent.command"],
      ["停机", commands.stop || "stop-agent.command"],
      ["卸载", commands.uninstall || "uninstall-agent.command"]
    ].forEach(([label, command]) => {
      const card = document.createElement("article");
      card.className = "agent-command-item";
      card.innerHTML = `
        <span>${escapeHtml(label)}</span>
        <code>${escapeHtml(command)}</code>
        <button type="button">复制</button>
      `;
      card.querySelector("button").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(command);
          showToast(toastEl, `已复制：${label}`, 2200);
        } catch {
          showToast(toastEl, "复制失败", 2200);
        }
      });
      agentCommandList.appendChild(card);
    });
  }

  function renderAgentCliList(cli) {
    agentCliList.innerHTML = "";
    Object.entries(cli).forEach(([name, item]) => {
      const row = document.createElement("article");
      row.className = "agent-cli-row";
      row.classList.toggle("missing", !item.available);
      row.innerHTML = `
        <span>${escapeHtml(formatCliName(name))}</span>
        <strong>${item.available ? "可用" : "缺失"}</strong>
        <p>${escapeHtml(item.version || item.error || item.command || "")}</p>
      `;
      agentCliList.appendChild(row);
    });
  }

  function formatAgentLogs(logs = {}) {
    return [
      `stdout: ${logs.stdout || ".codex_tmp/agent.out.log"}`,
      `stderr: ${logs.stderr || ".codex_tmp/agent.err.log"}`
    ].join("\n");
  }

loadAgentStatus();
