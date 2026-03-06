from helpers.extension import Extension
from agent import LoopData
from plugins.infection_check.helpers.checker import get_checker


class InfectionAnalyzeThoughts(Extension):
    """Start background analysis when thoughts are complete (thoughts mode only).

    Triggers as soon as headline or tool_name appear in the parsed response,
    meaning the thoughts section is done and tool usage is beginning.
    """

    async def execute(self, loop_data=LoopData(), text="", parsed={}, **kwargs):
        if not self.agent or not parsed:
            return
        checker = get_checker(self.agent)
        if checker.mode != "thoughts" or checker.analysis_started:
            return
        if parsed.get("headline") or parsed.get("tool_name"):
            checker.start_analysis(self.agent)
