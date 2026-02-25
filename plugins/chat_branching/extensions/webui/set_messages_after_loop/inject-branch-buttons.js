// Chat Branching Plugin — injects a "branch" button into every message's action bar.
// Runs as a set_messages_after_loop JS extension.
//
// Uses the unified handler output: context.results is an array of
// { args: { no, id, type, … }, result: { element, … } } from each setMessage() call.

import { createActionButton } from "/components/messages/action-buttons/simple-action-buttons.js";
import { callJsonApi } from "/js/api.js";

export default async function injectBranchButtons(context) {
  if (!context?.results?.length) return;

  for (const { args, result } of context.results) {
    if (!result?.element || args.no == null) continue;

    const bar = result.element.querySelector(".step-action-buttons");
    if (!bar || bar.querySelector(".action-fork_right")) continue;

    const logNo = args.no;
    const btn = createActionButton("fork_right", "Branch chat", async () => {
      const ctxid = globalThis.getContext?.();
      if (!ctxid) throw new Error("No active chat");

      const res = await callJsonApi("/plugins/chat_branching/branch_chat", {
        context: ctxid,
        log_no: logNo,
      });

      if (!res?.ok) throw new Error(res?.message || "Branch failed");

      // Select the newly created branch chat
      const chatsStore = Alpine.store("chats");
      if (chatsStore) {
        chatsStore.selectChat(res.ctxid);
      }
    });

    if (btn) bar.appendChild(btn);
  }
}