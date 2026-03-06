from helpers.extension import Extension
from agent import LoopData
from plugins.infection_check.helpers.checker import get_checker


class InfectionAnalyzeEnd(Extension):
    async def execute(self, loop_data=LoopData(), **kwargs):
        if not self.agent:
            return
        checker = get_checker(self.agent)
        if not checker.analysis_started:
            checker.start_analysis(self.agent)
