from python.helpers.api import ApiHandler, Request, Response
from python.helpers import plugins, files


class Plugins(ApiHandler):
    """
    Core plugin management API.
    Actions: get_config, save_config
    """

    async def process(self, input: dict, request: Request) -> dict | Response:
        action = input.get("action", "get_config")

        # Accept legacy aliases during migration.
        if action == "get_config":
            plugin_name = input.get("plugin_name", "")
            project_name = input.get("project_name", "")
            agent_profile = input.get("agent_profile", "")
            if not plugin_name:
                return Response(status=400, response="Missing plugin_name")

            result = plugins.find_plugin_assets(
                plugins.CONFIG_FILE_NAME,
                plugin_name=plugin_name,
                project_name=project_name,
                agent_profile=agent_profile,
                only_first=True,
            )
            if result:
                entry = result[0]
                path = entry.get("path", "")
                settings = files.read_file_json(path) if path else {}
                loaded_project_name = entry.get("project_name", "")
                loaded_agent_profile = entry.get("agent_profile", "")
            else:
                settings = plugins.get_plugin_config(plugin_name, agent=None) or {}
                default_path = files.get_abs_path(
                    plugins.find_plugin_dir(plugin_name), plugins.CONFIG_DEFAULT_FILE_NAME
                )
                path = default_path if files.exists(default_path) else ""
                loaded_project_name = ""
                loaded_agent_profile = ""

            return {
                "ok": True,
                "loaded_path": path,
                "loaded_project_name": loaded_project_name,
                "loaded_agent_profile": loaded_agent_profile,
                "data": settings,
            }

        if action == "save_config":
            plugin_name = input.get("plugin_name", "")
            project_name = input.get("project_name", "")
            agent_profile = input.get("agent_profile", "")
            settings = input.get("settings", {})
            if not plugin_name:
                return Response(status=400, response="Missing plugin_name")
            if not isinstance(settings, dict):
                return Response(status=400, response="settings must be an object")
            plugins.save_plugin_config(plugin_name, project_name, agent_profile, settings)
            return {"ok": True}

        return Response(status=400, response=f"Unknown action: {action}")
