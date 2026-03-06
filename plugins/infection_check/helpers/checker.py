"""Core infection check logic."""

import re
import asyncio
from typing import TYPE_CHECKING

from helpers import plugins
from helpers import history as history_helpers
from helpers.errors import HandledException
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

if TYPE_CHECKING:
    from agent import Agent
    from helpers.log import LogItem

PLUGIN_NAME = "infection_check"
DATA_KEY = f"_plugin.{PLUGIN_NAME}"
DATA_KEY_TASK = f"{DATA_KEY}.task"

_RE_OK = re.compile(r"<ok\s*/>")
_RE_TERMINATE = re.compile(r"<terminate\s*/>")
_RE_CLARIFY = re.compile(r"<clarify>(.*?)</clarify>", re.DOTALL)


def get_config(agent: "Agent") -> dict:
    return plugins.get_plugin_config(PLUGIN_NAME, agent=agent) or {}


def get_checker(agent: "Agent") -> "InfectionChecker":
    """Return the checker for the current loop iteration, creating one if needed."""
    checker: "InfectionChecker | None" = agent.get_data(DATA_KEY)
    loop = getattr(agent, "loop_data", None)
    iteration = loop.iteration if loop else -1
    if checker is None or checker.iteration != iteration:
        checker = InfectionChecker(config=get_config(agent), iteration=iteration)
        agent.set_data(DATA_KEY, checker)
    return checker


def parse_result(text: str) -> tuple[str, str]:
    """Find the **last** result tag in *text*.  Returns ``(action, detail)``."""
    pos = -1
    action, detail = "ok", ""
    for m in _RE_OK.finditer(text):
        if m.start() > pos:
            pos, action, detail = m.start(), "ok", ""
    for m in _RE_TERMINATE.finditer(text):
        if m.start() > pos:
            pos, action, detail = m.start(), "terminate", ""
    for m in _RE_CLARIFY.finditer(text):
        if m.start() > pos:
            pos, action, detail = m.start(), "clarify", m.group(1).strip()
    return action, detail


class InfectionChecker:
    def __init__(self, config: dict, iteration: int):
        self.mode: str = config.get("mode", "thoughts")
        self.model_choice: str = config.get("model", "utility")
        self.prompt: str = config.get("prompt", "")
        self.history_size: int = int(config.get("history_size", 10))
        self.max_clarifications: int = int(config.get("max_clarifications", 3))
        self.iteration = iteration

        self.reasoning_log = ""
        self.response_log = ""
        self.analysis_started = False
        self._clarify_count = 0
        self._check_msgs: list = []

    # -- collection ---------------------------------------------------------

    def collect_reasoning(self, full_text: str):
        self.reasoning_log = full_text

    def collect_response(self, full_text: str):
        if not self.analysis_started:
            self.response_log = full_text

    # -- analysis trigger ---------------------------------------------------

    def start_analysis(self, agent: "Agent") -> "asyncio.Task | None":
        if self.analysis_started:
            return None
        self.analysis_started = True
        snapshot = self._build_log()
        if not snapshot.strip():
            return None
        task = asyncio.create_task(self._run_check(agent, snapshot))
        agent.set_data(DATA_KEY_TASK, task)
        return task

    # -- result gate (called from tool_execute_before) ----------------------

    async def handle_result(self, agent: "Agent", log_item: "LogItem"):
        task: "asyncio.Task | None" = agent.get_data(DATA_KEY_TASK)
        if task is None:
            return

        try:
            if not task.done():
                log_item.update(heading="Infection check in progress...")
            action, detail = await task
        except Exception as e:
            # Don't block the agent if the check itself errors out
            log_item.update(heading="Infection check error", content=str(e))
            agent.set_data(DATA_KEY_TASK, None)
            return

        agent.set_data(DATA_KEY_TASK, None)

        if action == "clarify":
            action, detail = await self._clarify_loop(agent, detail, log_item)

        if action == "ok":
            log_item.update(heading="Infection check passed")
            return

        # terminate
        log_item.update(
            type="warning",
            heading="Infection check: TERMINATED",
            content=detail or "Malicious behavior detected.",
        )
        raise HandledException(
            Exception(
                "Infection check terminated the agent: "
                + (detail or "threat detected")
            )
        )

    # -- internals ----------------------------------------------------------

    def _build_log(self) -> str:
        parts = []
        if self.reasoning_log:
            parts.append(f"## Agent Reasoning\n{self.reasoning_log}")
        if self.response_log:
            parts.append(f"## Agent Response\n{self.response_log}")
        return "\n\n".join(parts)

    def _get_model(self, agent: "Agent"):
        if self.model_choice == "main":
            return agent.get_chat_model()
        return agent.get_utility_model()

    async def _run_check(
        self, agent: "Agent", log_text: str
    ) -> tuple[str, str]:
        hist = agent.history.output()
        if self.history_size > 0:
            hist = hist[-self.history_size :]
        hist_text = history_helpers.output_text(
            hist, ai_label="assistant", human_label="user"
        )

        user_msg = (
            f"## Recent Conversation History\n{hist_text}\n\n"
            f"## Current Agent Output to Analyze\n{log_text}"
        )

        self._check_msgs = [
            SystemMessage(content=self.prompt),
            HumanMessage(content=user_msg),
        ]
        model = self._get_model(agent)
        response, _ = await model.unified_call(messages=list(self._check_msgs))
        self._check_msgs.append(AIMessage(content=response))
        return parse_result(response)

    async def _clarify_loop(
        self, agent: "Agent", clarify_text: str, log_item: "LogItem"
    ) -> tuple[str, str]:
        while self._clarify_count < self.max_clarifications:
            self._clarify_count += 1
            log_item.update(
                type="warning",
                heading=f"Infection check: clarification {self._clarify_count}/{self.max_clarifications}",
                content=f"Asking agent:\n{clarify_text}",
            )

            # Clone conversation history + append clarification question
            chat_msgs = agent.history.output_langchain()
            chat_msgs.append(HumanMessage(content=clarify_text))
            agent_resp, _ = await agent.get_chat_model().unified_call(
                messages=chat_msgs
            )

            log_item.stream(content=f"\n\nAgent response:\n{agent_resp}")

            # Feed response back to check model for re-evaluation
            self._check_msgs.append(
                HumanMessage(
                    content=(
                        f"The agent responded:\n\n{agent_resp}\n\n"
                        "Re-evaluate and provide your verdict."
                    )
                )
            )
            check_model = self._get_model(agent)
            check_resp, _ = await check_model.unified_call(
                messages=list(self._check_msgs)
            )
            self._check_msgs.append(AIMessage(content=check_resp))

            action, detail = parse_result(check_resp)
            if action != "clarify":
                return action, detail
            clarify_text = detail

        return "terminate", "Maximum clarification attempts exceeded."
