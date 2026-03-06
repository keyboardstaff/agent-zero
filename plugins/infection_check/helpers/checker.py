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
DATA_KEY_CLARIFIED = f"{DATA_KEY}.clarified"

_RE_OK = re.compile(r"<ok\s*/>")
_RE_TERMINATE = re.compile(r"<terminate\s*/>")
_RE_CLARIFY = re.compile(r"<clarify>(.*?)</clarify>", re.DOTALL)


def get_config(agent: "Agent") -> dict:
    return plugins.get_plugin_config(PLUGIN_NAME, agent=agent) or {}


def get_checker(agent: "Agent") -> "InfectionChecker":
    checker: "InfectionChecker | None" = agent.get_data(DATA_KEY)
    loop = getattr(agent, "loop_data", None)
    iteration = loop.iteration if loop else -1
    if checker is None or checker.iteration != iteration:
        prev_task = agent.get_data(DATA_KEY_TASK)
        if prev_task and not prev_task.done():
            prev_task.cancel()
        agent.set_data(DATA_KEY_TASK, None)
        checker = InfectionChecker(config=get_config(agent), iteration=iteration)
        agent.set_data(DATA_KEY, checker)
    return checker


def parse_result(text: str) -> tuple[str, str]:
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
        self._result_consumed = False
        self._clarify_count = 0
        self._check_msgs: list = []
        self._check_cot = ""

    def collect_reasoning(self, full_text: str):
        self.reasoning_log = full_text

    def collect_response(self, full_text: str):
        if not self.analysis_started:
            self.response_log = full_text

    def start_analysis(self, agent: "Agent") -> "asyncio.Task | None":
        if self.analysis_started:
            return None
        self.analysis_started = True
        return self._create_check_task(agent)

    def ensure_analysis(self, agent: "Agent") -> "asyncio.Task | None":
        task = agent.get_data(DATA_KEY_TASK)
        if task is not None:
            return task
        if self._result_consumed:
            return None
        self.analysis_started = True
        task = self._create_check_task(agent)
        if task is None:
            self._result_consumed = True
        return task

    def _create_check_task(self, agent: "Agent") -> "asyncio.Task | None":
        snapshot = self._build_log()
        if not snapshot.strip():
            return None
        task = asyncio.create_task(self._run_check(agent, snapshot))
        agent.set_data(DATA_KEY_TASK, task)
        return task

    async def handle_result(self, agent: "Agent", log_item: "LogItem"):
        if agent.get_data(DATA_KEY_CLARIFIED):
            return

        task: "asyncio.Task | None" = agent.get_data(DATA_KEY_TASK)
        if task is None:
            return

        try:
            if not task.done():
                progress_item = agent.context.log.log(
                    type="info",
                    heading="Verifying operation safety...",
                )
                while not task.done():
                    if self._check_cot:
                        progress_item.update(content=self._check_cot)
                    await asyncio.sleep(0.4)
                if self._check_cot:
                    progress_item.update(content=self._check_cot)

            action, detail, cot = await task
        except Exception as e:
            log_item.update(heading="Infection check error", content=str(e))
            agent.set_data(DATA_KEY_TASK, None)
            self._result_consumed = True
            return

        agent.set_data(DATA_KEY_TASK, None)
        self._result_consumed = True

        if action == "ok":
            return

        if action == "clarify":
            warn_item = agent.context.log.log(
                type="warning",
                heading="Infection check: requesting clarification",
                content=f"Safety concern:\n{cot}" if cot else "",
            )
            action, detail, cot = await self._clarify_loop(agent, detail, warn_item)
            if action == "ok":
                warn_item.update(heading="Infection check: clarification passed")
                agent.set_data(DATA_KEY_CLARIFIED, True)
                return

        content = cot or detail or self._build_log() or "Malicious behavior detected."
        agent.context.log.log(
            type="warning",
            heading="Infection check: TERMINATED",
            content=content,
        )
        from helpers.notification import NotificationManager, NotificationType, NotificationPriority
        NotificationManager.send_notification(
            type=NotificationType.ERROR,
            priority=NotificationPriority.HIGH,
            title="Infection Check",
            message="Threat detected — agent execution terminated.",
            detail=detail or "Malicious behavior detected.",
            display_time=8,
        )
        raise HandledException(
            Exception("Infection check terminated: " + (detail or "threat detected"))
        )

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

    async def _run_check(self, agent: "Agent", log_text: str) -> tuple[str, str, str]:
        hist = agent.history.output()
        if self.history_size > 0:
            hist = hist[-self.history_size:]
        hist_text = history_helpers.output_text(hist, ai_label="assistant", human_label="user")

        user_msg = (
            f"## Recent Conversation History\n{hist_text}\n\n"
            f"## Current Agent Output to Analyze\n{log_text}"
        )
        self._check_msgs = [
            SystemMessage(content=self.prompt),
            HumanMessage(content=user_msg),
        ]
        model = self._get_model(agent)
        self._check_cot = ""

        async def _cb(chunk: str, full: str):
            self._check_cot = full

        response, _ = await model.unified_call(
            messages=list(self._check_msgs),
            response_callback=_cb,
        )
        self._check_msgs.append(AIMessage(content=response))
        action, detail = parse_result(response)
        return action, detail, response

    async def _clarify_loop(
        self, agent: "Agent", clarify_text: str, log_item: "LogItem"
    ) -> tuple[str, str, str]:
        cot_parts: list[str] = []
        while self._clarify_count < self.max_clarifications:
            self._clarify_count += 1
            log_item.update(
                heading=f"Infection check: clarification {self._clarify_count}/{self.max_clarifications}",
                content=f"Safety model question:\n{clarify_text}",
            )

            chat_msgs = agent.history.output_langchain()
            chat_msgs.append(HumanMessage(content=clarify_text))

            async def _agent_cb(chunk: str, full: str):
                if chunk:
                    log_item.stream(content=chunk)

            log_item.stream(content="\n\nAgent response:\n")
            agent_resp, _ = await agent.get_chat_model().unified_call(
                messages=chat_msgs, response_callback=_agent_cb,
            )
            cot_parts.append(f"Q: {clarify_text}\nA: {agent_resp}")
            log_item.stream(content="\n\nRe-evaluating...")

            self._check_msgs.append(HumanMessage(content=(
                f"The agent responded:\n\n{agent_resp}\n\n"
                "Re-evaluate and provide your verdict."
            )))
            check_model = self._get_model(agent)

            async def _check_cb(chunk: str, full: str):
                if chunk:
                    log_item.stream(content=chunk)

            log_item.stream(content="\n\nSafety model verdict:\n")
            check_resp, _ = await check_model.unified_call(
                messages=list(self._check_msgs), response_callback=_check_cb,
            )
            self._check_msgs.append(AIMessage(content=check_resp))
            cot_parts.append(f"Safety: {check_resp}")

            action, detail = parse_result(check_resp)
            if action != "clarify":
                return action, detail, "\n\n".join(cot_parts)
            clarify_text = detail

        return "terminate", "Max clarifications exceeded.", "\n\n".join(cot_parts)
