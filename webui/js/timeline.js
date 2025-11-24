import { store as preferencesStore } from "/components/sidebar/bottom/preferences/preferences-store.js";

const entryMap = new Map();
let track = null;
const activeFilters = new Set();
let toolbarRef = null;
let resizeListenerBound = false;
let clearanceFrame = null;

function dispatchExecutionPanelEvent(name, detail = {}) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(name, { detail }));
}

const TYPE_INFO = {
	user: { label: "User", color: "#3b82f6", column: "dialogue" },
	agent: { label: "Agent", color: "#8b5cf6", column: "dialogue" },
	response: { label: "Agent", color: "#8b5cf6", column: "dialogue" },
	warning: { label: "Warning", color: "#f59e0b", column: "system" },
	rate_limit: { label: "Warning", color: "#f59e0b", column: "system" },
	error: { label: "Error", color: "#ef4444", column: "system" },
	tool: { label: "Tool", color: "#10b981", column: "system" },
	code_exe: { label: "Code", color: "#06b6d4", column: "system" },
	browser: { label: "Browser", color: "#f97316", column: "system" },
	util: { label: "System", color: "#6b7280", column: "system" },
	info: { label: "Info", color: "#6b7280", column: "system" },
};

const ICON_TOKEN_REGEX = /icon:\/\/(network_intelligence|construction|chat)/gi;

const FILTER_GROUPS = {
	dialogue: {
		label: "Dialogue",
		types: new Set(["user", "agent", "response"]),
	},
	tools: {
		label: "Tools",
		types: new Set(["tool", "code_exe", "browser"]),
	},
	warnings: {
		label: "Warnings",
		types: new Set(["warning", "rate_limit", "error"]),
	},
	system: {
		label: "System",
		types: new Set(["util", "info", "hint"]),
	},
};

const FILTER_ORDER = ["dialogue", "tools", "warnings", "system"];

function ensureTrack() {
	const root = document.getElementById("timeline-view");
	if (!root) return null;

	let trackEl = root.querySelector(".timeline-track");
	if (!trackEl) {
		trackEl = document.createElement("div");
		trackEl.className = "timeline-track";
		root.appendChild(trackEl);
	}

	track = trackEl;
	ensureToolbar(trackEl);
	return trackEl;
}

function ensureToolbar(trackEl) {
	let toolbar = trackEl.querySelector(".timeline-toolbar");
	if (!toolbar) {
		toolbar = document.createElement("div");
		toolbar.className = "timeline-toolbar";
		toolbar.innerHTML = `
			<div class="timeline-toolbar__filters" role="group" aria-label="Timeline filters">
				<button class="timeline-filter is-active" data-filter="all" type="button">All</button>
				${FILTER_ORDER.map(
					(filter) =>
						`<button class="timeline-filter" data-filter="${filter}" type="button">${FILTER_GROUPS[filter].label}</button>`
				).join("")}
			</div>
		`;
		toolbar.addEventListener("click", handleFilterInteraction);
		trackEl.prepend(toolbar);
	}
	toolbarRef = toolbar;
	syncToolbarState(toolbar);
	queueToolbarClearanceUpdate();
	ensureResizeListener();
}

function ensureResizeListener() {
	if (resizeListenerBound || typeof window === "undefined") return;
	resizeListenerBound = true;
	window.addEventListener("resize", queueToolbarClearanceUpdate, { passive: true });
}

function queueToolbarClearanceUpdate() {
	if (typeof window === "undefined") return;
	if (clearanceFrame) cancelAnimationFrame(clearanceFrame);
	clearanceFrame = requestAnimationFrame(() => {
		clearanceFrame = null;
		updateToolbarClearance();
	});
}

function updateToolbarClearance() {
	if (!track || !toolbarRef) return;
	const clearance = toolbarRef.offsetHeight + 24;
	track.style.setProperty("--timeline-toolbar-clearance", `${clearance}px`);
}

function autoScrollTimelineView() {
	if (!preferencesStore.autoScroll) return;
	const scrollHost = document.querySelector("[data-execution-scroll]");
	const timelineView = document.getElementById("timeline-view");
	const target = scrollHost || timelineView;
	if (!target) return;
	requestAnimationFrame(() => {
		const top = target.scrollHeight;
		if (typeof target.scrollTo === "function") {
			target.scrollTo({ top, behavior: "smooth" });
		} else {
			target.scrollTop = top;
		}
	});
}

function handleFilterInteraction(event) {
	const button = event.target.closest(".timeline-filter");
	if (!button) return;
	const filter = button.dataset.filter;
	const toolbar = button.closest(".timeline-toolbar");
	if (filter === "all") {
		activeFilters.clear();
		syncToolbarState(toolbar);
		applyFilters();
		return;
	}

	if (activeFilters.has(filter)) {
		activeFilters.delete(filter);
	} else {
		activeFilters.add(filter);
	}

	syncToolbarState(toolbar);
	applyFilters();
}

function syncToolbarState(toolbar) {
	const allButton = toolbar.querySelector('[data-filter="all"]');
	if (!activeFilters.size) {
		allButton?.classList.add("is-active");
		toolbar
			?.querySelectorAll('.timeline-filter:not([data-filter="all"])')
			.forEach((btn) => btn.classList.remove("is-active"));
	} else {
		allButton?.classList.remove("is-active");
		toolbar
			?.querySelectorAll('.timeline-filter:not([data-filter="all"])')
			.forEach((btn) =>
				btn.classList.toggle("is-active", activeFilters.has(btn.dataset.filter))
			);
	}
}

function applyFilters() {
	if (!track) return;
	const entries = track.querySelectorAll(".timeline-entry");
	entries.forEach((entry) => {
		entry.hidden = !entryMatchesActiveFilters(entry.dataset.messageType);
	});
}

function entryMatchesActiveFilters(type) {
	if (!activeFilters.size) return true;
	for (const filter of activeFilters) {
		const config = FILTER_GROUPS[filter];
		if (config?.types?.has(type)) return true;
	}
	return false;
}

function resolveTypeInfo(type) {
	return TYPE_INFO[type] || {
		label:
			type?.replace(/_/g, " ")?.replace(/\b\w/g, (c) => c.toUpperCase()) || "Message",
		color: "#6b7280",
		column: "dialogue",
	};
}

function formatTimestamp(createdAt) {
	const date = createdAt ? new Date(createdAt) : new Date();
	if (Number.isNaN(date.getTime())) return "--";
	const datePart = date.toLocaleDateString([], {
		year: "numeric",
		month: "short",
		day: "2-digit",
	});
	const timePart = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return `${datePart} · ${timePart}`;
}

function sanitizeIconTokens(text) {
	if (!text) return text;
	return text.replace(ICON_TOKEN_REGEX, " ");
}

function escapeHtml(value = "") {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			default:
				return char;
		}
	});
}

function tryFormatJson(value) {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return JSON.stringify(parsed, null, 2);
	} catch (error) {
		return null;
	}
}

function renderListBlock(block) {
	const lines = block
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.length) return "";
	const isOrdered = lines.every((line) => /^\d+\.\s+/.test(line));
	const listTag = isOrdered ? "ol" : "ul";
	return `<${listTag}>${lines
		.map((line) => {
			const content = line.replace(isOrdered ? /^\d+\.\s+/ : /^[-*+]\s+/, "");
			return `<li>${applyInlineMarkdown(escapeHtml(content))}</li>`;
		})
		.join("")}</${listTag}>`;
}

function isListBlock(block) {
	const lines = block
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.length) return false;
	return lines.every((line) => /^(-|\*|\+|\d+\.)\s+/.test(line));
}

function applyInlineMarkdown(text) {
	if (!text) return "";
	return text
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/__(.+?)__/g, "<strong>$1</strong>")
		.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
		.replace(/_(?!_)(.+?)_(?!_)/g, "<em>$1</em>")
		.replace(/~~(.+?)~~/g, "<del>$1</del>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function renderHeadingBlock(block) {
	const match = block.match(/^(#{1,6})\s+(.+)/);
	if (!match) return null;
	const level = Math.min(match[1].length, 6);
	const content = match[2]?.trim();
	if (!content) return null;
	const html = applyInlineMarkdown(escapeHtml(content));
	return `<h${level} class="timeline-body__heading level-${level}">${html}</h${level}>`;
}

function renderTextBlock(block) {
	const trimmed = block?.trim();
	if (!trimmed) return null;
	const heading = renderHeadingBlock(trimmed);
	if (heading) return heading;
	if (isListBlock(trimmed)) {
		return renderListBlock(trimmed);
	}
	const safe = escapeHtml(trimmed);
	const rich = applyInlineMarkdown(safe);
	return `<p>${rich.replace(/\n/g, "<br>")}</p>`;
}

function formatBodyContent(content) {
	const sanitized = sanitizeIconTokens(content || "");
	if (!sanitized?.trim()) return "<p>No content.</p>";
	const segments = sanitized
		.split(/```([\s\S]*?)```/g)
		.map((segment, index) => ({
			type: index % 2 ? "code" : "text",
			value: segment,
		}))
		.filter((segment) => segment.value);
	return segments
		.map((segment) => {
			if (segment.type === "code") {
				return `<pre><code>${escapeHtml(segment.value.trim())}</code></pre>`;
			}
			const maybeJson = tryFormatJson(segment.value);
			if (maybeJson) {
				return `<pre><code>${escapeHtml(maybeJson)}</code></pre>`;
			}
			return segment.value
				.split(/\n{2,}/)
				.map((block) => renderTextBlock(block))
				.filter(Boolean)
				.join("");
		})
		.join("") || "<p>No content.</p>";
}

function getEntryId(log) {
	return (
		log?.id ||
		log?.no ||
		log?.message_id ||
		`timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	);
}

export function addTimelineEvent(log) {
	if (!log) return;
	const trackEl = ensureTrack();
	if (!trackEl) return;

	const info = resolveTypeInfo(log.type);
	const lane = info.column === "system" ? "system" : "dialogue";

	const id = getEntryId(log);
	let entry = entryMap.get(id);
	if (!entry) {
		entry = document.createElement("article");
		entry.dataset.id = id;
		entryMap.set(id, entry);
		trackEl.appendChild(entry);
	}

	entry.className = `timeline-entry timeline-entry--${lane}`;
	entry.dataset.lane = lane;

	const timestamp = formatTimestamp(log.created_at || log.timestamp);
	const body = formatBodyContent(log.content || log.text || "");
	const heading = sanitizeIconTokens(log.heading)?.trim() || info.label;

	entry.style.setProperty("--entry-accent", info.color);
	entry.dataset.messageType = log.type || "info";
	entry.innerHTML = `
		<div class="timeline-entry__wrapper">
			<span class="timeline-entry__connector" aria-hidden="true"></span>
			<div class="timeline-entry__card">
				<span class="timeline-entry__accent" aria-hidden="true"></span>
				<div class="timeline-entry__header">
					<span class="timeline-entry__label">${info.label}</span>
					<span class="timeline-entry__time">${timestamp}</span>
				</div>
				<div class="timeline-entry__heading">${escapeHtml(heading)}</div>
				<div class="timeline-entry__body">${body}</div>
			</div>
		</div>
	`;
	applyFilters();
	autoScrollTimelineView();
	dispatchExecutionPanelEvent("execution-panel:update", { log });
}

export function resetTimeline() {
	entryMap.clear();
	if (track) {
		track.querySelectorAll(".timeline-entry").forEach((entry) => entry.remove());
	}
	dispatchExecutionPanelEvent("execution-panel:reset");
}
