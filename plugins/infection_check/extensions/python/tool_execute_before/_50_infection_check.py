from helpers.extension import Extension
from plugins.infection_check.helpers.checker import get_checker, DATA_KEY_TASK


class InfectionAwaitCheck(Extension):
    """Gate before tool execution — await infection check result."""

    async def execute(self, tool_name="", tool_args={}, **kwargs):
        if not self.agent:
            return
        task = self.agent.get_data(DATA_KEY_TASK)
        if task is None:
            return
        checker = get_checker(self.agent)
        log_item = self.agent.context.log.log(
            type="util",
            heading="Infection check...",
        )
        await checker.handle_result(self.agent, log_item)
