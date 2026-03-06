from helpers.extension import Extension
from agent import LoopData
from plugins.infection_check.helpers.checker import get_checker


class InfectionAnalyzeEnd(Extension):
    """Start analysis when the full response is available.

    In *complete* mode this is the primary trigger.
    In *thoughts* mode this acts as a fallback if response_stream never fired.
    """

    async def execute(self, loop_data=LoopData(), **kwargs):
        if not self.agent:
            return
        checker = get_checker(self.agent)
        if not checker.analysis_started:
            checker.start_analysis(self.agent)
