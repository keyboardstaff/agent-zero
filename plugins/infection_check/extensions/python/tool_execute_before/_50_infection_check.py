from helpers.extension import Extension
from plugins.infection_check.helpers.checker import get_checker


class InfectionAwaitCheck(Extension):
    async def execute(self, tool_name="", tool_args={}, **kwargs):
        if not self.agent:
            return
        checker = get_checker(self.agent)
        checker.ensure_analysis(self.agent)
        log_item = self.agent.context.log.log(type="util", heading="Infection check...")
        await checker.handle_result(self.agent, log_item)
