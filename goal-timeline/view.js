// Progress timeline: completed tasks and dev logs on one time axis, followed by
// the most recent work and whatever is still open. Reads the current note, which
// can be a Goal or a Project. A Project includes its child goals and subprojects.
//
// Usage from a Goal or Project note:
//   ```dataviewjs
//   await dv.view("Config/scripts/dataview/goal-timeline");
//   ```
//
// Usage from a homepage, for active goals and projects across all notes:
//   ```dataviewjs
//   await dv.view("Config/scripts/dataview/goal-timeline", { mode: "overview" });
//   ```

const VIEW_PATH = "Config/scripts/dataview/goal-timeline";
const STALE_DAYS = 30;
const RECENT_DAYS = 14;
const ACTIVITY_DAYS = 30;
const NEXT_LIMIT = 6;
const DAY_MS = 86400000;
const CLOSED = new Set(["Completed", "Cancelled", "Done"]);
const OPEN_DAYS = 4;
const READY_LIMIT = 8;
const STACK_LIMIT = 6;

const current = input?.target ? dv.page(input.target) : dv.current();
const container = input?.container ?? dv.container;
const goalName = current.file.name;

const iso = (value) => {
    if (!value) return null;
    const text = value.toISODate?.() ?? String(value);
    return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
};
const dayMs = (date) => Date.parse(`${date}T00:00:00Z`);
const shortDate = (date) =>
    new Date(dayMs(date)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const list = (value) => {
    if (value == null) return [];
    if (typeof value.array === "function") return value.array();
    return Array.isArray(value) ? value : [value];
};
const linkName = (link) =>
    String(link?.path ?? link ?? "")
        .replace(/^\[\[|\]\]$/g, "")
        .split("|")[0]
        .split("/")
        .pop()
        .replace(/\.md$/, "");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const now = new Date();
const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Config holds templates, whose placeholder frontmatter must not count as real work.
const pages = dv.pages().array().filter((page) => !page.file.path.startsWith("Config/"));
const isType = (page, type) => linkName(page["note.type"]) === type;
const links = (page, key) => list(page[key]).map(linkName);
const isProject = isType(current, "Project");

// A Goal covers itself. A Project also covers every goal and subproject below it.
const containers = pages.filter((page) => isType(page, "Goal") || isType(page, "Project"));
const scopeFor = (note) => {
    const names = new Set([note.file.name]);
    if (!isType(note, "Project")) return names;
    let grew = true;
    while (grew) {
        grew = false;
        for (const page of containers) {
            if (!names.has(page.file.name) && links(page, "parent").some((name) => names.has(name))) {
                names.add(page.file.name);
                grew = true;
            }
        }
    }
    return names;
};
const scope = scopeFor(current);
const inScope = (page) => [...links(page, "goal"), ...links(page, "parent")].some((name) => scope.has(name));

const tasks = pages
    .filter((page) => isType(page, "Task") && inScope(page))
    .map((page) => ({
        kind: "task",
        name: page.file.name,
        path: page.file.path,
        status: linkName(page["task.status"]) || "No status",
        date: iso(page["task.completed"]),
        goals: links(page, "goal"),
    }));
const taskNames = new Set(tasks.map((task) => task.name));

const logs = pages
    .filter((page) => isType(page, "Log") && inScope(page))
    .map((page) => ({
        kind: "log",
        name: page.file.name.replace(/^\d{4}-\d{2}-\d{2} - /, ""),
        path: page.file.path,
        date: iso(page["note.created"]),
        tasks: list(page.related).map(linkName).filter((name) => taskNames.has(name)),
    }))
    .filter((log) => log.date);

const closedTasks = tasks.filter((task) => CLOSED.has(task.status));
const openTasks = tasks.filter((task) => !CLOSED.has(task.status));
const datedTasks = closedTasks.filter((task) => task.date);
const undatedCount = closedTasks.length - datedTasks.length;
const events = [...datedTasks, ...logs].sort((a, b) => a.date.localeCompare(b.date));

// Reads the note's "Depends on:" line. Parentheticals and any sentence after the
// link list are commentary, so links there are not dependencies.
const dependencyNames = (text) => {
    const line = text.match(/^Depends on:(.*)$/m)?.[1] ?? "";
    const clause = line.replace(/\([^)]*\)/g, "").replace(/\]\]\.\s.*$/, "]]");
    return [...clause.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => linkName(match[1].split("#")[0]));
};
const openBlockers = (names) =>
    names.flatMap((name) => {
        const page = dv.page(name);
        if (!page) return [{ name, path: name, missing: true }];
        if (!isType(page, "Task") || CLOSED.has(linkName(page["task.status"]))) return [];
        return [{ name: page.file.name, path: page.file.path }];
    });
await Promise.all(
    openTasks.map(async (task) => {
        task.blockers = openBlockers(dependencyNames((await dv.io.load(task.path)) ?? ""));
    }),
);

const datePrefix = isProject ? "project" : "goal";
const started = iso(current[`${datePrefix}.started`]);
const finished = iso(current[`${datePrefix}.completed`]);
const due = iso(current[`${datePrefix}.dueDate`]);

const el = (tag, className, text, parent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    parent?.appendChild(node);
    return node;
};
const noteLink = (item, parent, className = "") => {
    const link = el("a", `internal-link ${className}`.trim(), item.name, parent);
    link.href = item.path;
    link.dataset.href = item.path;
    link.addEventListener("click", (event) => {
        event.preventDefault();
        app.workspace.openLinkText(item.path, current.file.path, event.metaKey || event.ctrlKey);
    });
    return link;
};

if (input?.mode === "overview") {
    const toItem = (page) => ({
        name: page.file.name,
        path: page.file.path,
        goals: links(page, "goal"),
        parents: links(page, "parent"),
    });
    const allTasks = pages
        .filter((page) => isType(page, "Task"))
        .map((page) => ({
            ...toItem(page),
            status: linkName(page["task.status"]) || "No status",
            date: iso(page["task.completed"]),
        }));
    const allLogs = pages
        .filter((page) => isType(page, "Log"))
        .map((page) => ({ ...toItem(page), date: iso(page["note.created"]) }))
        .filter((log) => log.date);
    const allOpen = allTasks.filter((task) => !CLOSED.has(task.status));
    await Promise.all(
        allOpen.map(async (task) => {
            task.blockers = openBlockers(dependencyNames((await dv.io.load(task.path)) ?? ""));
        }),
    );

    const daysAgo = (date) => Math.round((dayMs(today) - dayMs(date)) / DAY_MS);
    const ago = (date) => {
        if (!date) return "no activity";
        const count = daysAgo(date);
        return count <= 0 ? "today" : count === 1 ? "yesterday" : `${count}d ago`;
    };
    const rollup = (page, prefix) => {
        const within = scopeFor(page);
        const member = (item) => [...item.goals, ...item.parents].some((name) => within.has(name));
        const own = allTasks.filter(member);
        const open = own.filter((task) => !CLOSED.has(task.status));
        const blocked = open.filter((task) => task.blockers.length).length;
        const dates = [...own.map((task) => task.date), ...allLogs.filter(member).map((log) => log.date)];
        const last = dates.filter(Boolean).sort().pop() ?? null;
        const due = iso(page[`${prefix}.dueDate`]);
        const parent = links(page, "parent")[0];
        const prefixed = parent && page.file.name.startsWith(`${parent} `);
        return {
            name: prefixed ? page.file.name.slice(parent.length + 1) : page.file.name,
            fullName: page.file.name,
            path: page.file.path,
            closed: own.length - open.length,
            total: own.length,
            ready: open.length - blocked,
            blocked,
            last,
            overdue: Boolean(due && due < today),
            stale: !last || daysAgo(last) > STALE_DAYS,
        };
    };
    const byRecent = (a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.name.localeCompare(b.name);

    const goalRows = pages
        .filter((page) => isType(page, "Goal") && linkName(page["goal.status"]) === "In Progress")
        .map((page) => rollup(page, "goal"))
        .sort(byRecent);
    const isActiveProject = (page) => isType(page, "Project") && linkName(page["project.status"]) === "In Progress";
    const activeProjects = new Set(pages.filter(isActiveProject).map((page) => page.file.name));
    const projectRows = pages
        .filter((page) => isActiveProject(page) && !links(page, "parent").some((name) => activeProjects.has(name)))
        .map((page) => rollup(page, "project"))
        .sort(byRecent);

    const root = el("div", "goal-timeline gt-overview", null, container);
    const closedRecently = allTasks.filter(
        (task) => CLOSED.has(task.status) && task.date && daysAgo(task.date) >= 0 && daysAgo(task.date) < RECENT_DAYS,
    );
    el("div", "gt-summary", `${allOpen.length} open · ${closedRecently.length} closed in the last ${RECENT_DAYS} days`, root);

    const activity = el("div", "gt-activity", null, root);
    const series = Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
        const date = new Date(dayMs(today) - (ACTIVITY_DAYS - 1 - index) * DAY_MS).toISOString().slice(0, 10);
        return {
            date,
            tasks: allTasks.filter((task) => CLOSED.has(task.status) && task.date === date).length,
            logs: allLogs.filter((log) => log.date === date).length,
        };
    });
    const peak = Math.max(1, ...series.map((day) => day.tasks + day.logs));
    for (const day of series) {
        const column = el("div", "gt-activity-day", null, activity);
        column.title = `${shortDate(day.date)}: ${plural(day.tasks, "task")}, ${plural(day.logs, "log")}`;
        el("div", "gt-activity-log", null, column).style.height = `${(day.logs / peak) * 100}%`;
        el("div", "gt-activity-task", null, column).style.height = `${(day.tasks / peak) * 100}%`;
    }
    const legend = el("div", "gt-activity-axis", null, root);
    el("span", null, shortDate(series[0].date), legend);
    el("span", null, "tasks closed and logs written", legend);
    el("span", null, "Today", legend);

    const tabs = el("div", "gt-tabs", null, root);
    const rowsHost = el("div", "gt-rows", null, root);
    const renderRows = (rows, emptyText) => {
        rowsHost.replaceChildren();
        if (!rows.length) el("p", "gt-empty", emptyText, rowsHost);
        for (const row of rows) {
            const details = el("details", "gt-row", null, rowsHost);
            const summary = el("summary", null, null, details);
            noteLink(row, summary, "gt-goal-name");
            const bar = el("div", "gt-bar", null, summary);
            el("div", "gt-bar-fill", null, bar).style.width = `${row.total ? (row.closed / row.total) * 100 : 0}%`;
            el("span", "gt-goal-count", row.total ? `${row.closed}/${row.total}` : "no tasks", summary);
            const meta = [`${row.ready} unblocked`];
            if (row.blocked) meta.push(`${row.blocked} blocked`);
            meta.push(ago(row.last));
            el("span", "gt-row-meta", meta.join(" · "), summary);
            const flag = row.overdue ? "Overdue" : row.stale ? "Stale" : "";
            el("span", `gt-flag${flag ? ` gt-flag-${flag.toLowerCase()}` : ""}`, flag, summary);
            const body = el("div", "gt-row-body", null, details);
            details.addEventListener("toggle", async () => {
                if (!details.open || body.childElementCount) return;
                await dv.view(VIEW_PATH, { target: row.path, container: body });
            });
        }
    };
    const tabDefinitions = [
        ["Goals", goalRows, "No goals in progress."],
        ["Projects", projectRows, "No projects in progress."],
    ];
    const buttons = tabDefinitions.map(([label, rows, emptyText]) => {
        const button = el("button", "gt-tab", `${label} (${rows.length})`, tabs);
        button.addEventListener("click", () => {
            buttons.forEach((other) => other.classList.toggle("is-active", other === button));
            renderRows(rows, emptyText);
        });
        return button;
    });
    buttons[0].classList.add("is-active");
    renderRows(goalRows, tabDefinitions[0][2]);

    const grid = el("div", "gt-columns", null, root);
    const next = el("section", "gt-section", null, grid);
    el("h4", null, "Next up", next);
    const goalOrder = new Map(goalRows.map((row, index) => [row.fullName, index]));
    const goalIndex = (task) => Math.min(...task.goals.map((name) => goalOrder.get(name) ?? Infinity));
    const upNext = allOpen
        .filter((task) => task.status === "In Progress" && !task.blockers.length && Number.isFinite(goalIndex(task)))
        .sort((a, b) => goalIndex(a) - goalIndex(b) || a.name.localeCompare(b.name))
        .slice(0, NEXT_LIMIT);
    if (!upNext.length) el("p", "gt-empty", "No unblocked in-progress tasks on active goals.", next);
    const nextList = el("ul", null, null, next);
    for (const task of upNext) {
        const line = el("li", "gt-item gt-item-ready", null, nextList);
        noteLink(task, line);
        const goal = goalRows.find((row) => task.goals.includes(row.fullName));
        if (goal) el("span", "gt-tag", goal.name, line);
    }

    const attention = el("section", "gt-section", null, grid);
    el("h4", null, "Needs attention", attention);
    const overdueGoals = goalRows.filter((row) => row.overdue);
    const staleGoals = goalRows.filter((row) => row.stale && !row.overdue);
    const inReview = allOpen.filter((task) => task.status === "Review").length;
    const noGoal = allOpen.filter((task) => !task.goals.length).length;
    const notices = [
        [overdueGoals.length, `${plural(overdueGoals.length, "active goal")} overdue`, overdueGoals],
        [staleGoals.length, `${plural(staleGoals.length, "active goal")} with no work in ${STALE_DAYS} days`, staleGoals],
        [inReview, `${plural(inReview, "task")} in Review`, []],
        [noGoal, `${plural(noGoal, "open task")} with no goal`, []],
    ].filter(([count]) => count);
    if (!notices.length) el("p", "gt-empty", "Nothing needs attention.", attention);
    const noticeList = el("ul", null, null, attention);
    for (const [, text, rows] of notices) {
        const line = el("li", "gt-item gt-item-notice", text, noticeList);
        if (rows.length) line.title = rows.map((row) => row.name).join("\n");
    }
    return;
}

const root = el("div", "goal-timeline", null, container);

const summaryParts = [`${closedTasks.length}/${tasks.length} tasks closed`, plural(logs.length, "log")];
if (finished && due) {
    const days = Math.round((dayMs(due) - dayMs(finished)) / DAY_MS);
    const timing = days > 0 ? `${plural(days, "day")} early` : days < 0 ? `${plural(-days, "day")} late` : "on the due date";
    summaryParts.push(`finished ${shortDate(finished)}, ${timing}`);
} else if (due) {
    summaryParts.push(`due ${shortDate(due)}`);
}
if (undatedCount) summaryParts.push(`${undatedCount} closed without a date`);
el("div", "gt-summary", summaryParts.join(" · "), root);

const anchors = [started, finished, ...events.map((event) => event.date)].filter(Boolean);
if (!finished) anchors.push(today);
if (!finished && due) anchors.push(due);

if (!events.length) {
    el("p", "gt-empty", "No completed tasks or dev logs yet.", root);
} else {
    const first = anchors.reduce((a, b) => (a < b ? a : b));
    const last = anchors.reduce((a, b) => (a > b ? a : b));
    const span = Math.max(dayMs(last) - dayMs(first), DAY_MS);
    const position = (date) => `${((dayMs(date) - dayMs(first)) / span) * 100}%`;
    const inRange = (date) => date && date >= first && date <= last;

    const chart = el("div", "gt-chart", null, root);

    for (const [kind, label] of [["task", "Tasks"], ["log", "Logs"]]) {
        const lane = el("div", "gt-lane", null, chart);
        el("div", "gt-lane-label", label, lane);
        const track = el("div", "gt-track", null, lane);
        const byDay = new Map();
        for (const event of events.filter((item) => item.kind === kind)) {
            byDay.set(event.date, [...(byDay.get(event.date) ?? []), event]);
        }
        const tallest = Math.max(1, ...[...byDay.values()].map((items) => Math.min(items.length, STACK_LIMIT)));
        track.style.height = `${tallest * 12 + 10}px`;
        for (const [date, items] of byDay) {
            const overflow = items.length > STACK_LIMIT;
            const shown = overflow ? items.slice(0, STACK_LIMIT - 1) : items;
            if (overflow) {
                const hidden = items.slice(STACK_LIMIT - 1);
                const more = el("span", "gt-more", `+${hidden.length}`, track);
                more.title = `${shortDate(date)}\n${hidden.map((item) => item.name).join("\n")}`;
                more.style.left = position(date);
                more.style.bottom = `${(STACK_LIMIT - 1) * 12 + 3}px`;
            }
            shown.forEach((item, index) => {
                const dot = noteLink(item, track, `gt-dot gt-${kind}`);
                dot.textContent = "";
                dot.title = `${shortDate(date)} · ${item.name}`;
                dot.setAttribute("aria-label", dot.title);
                dot.style.left = position(date);
                dot.style.bottom = `${index * 12 + 5}px`;
            });
        }
    }

    const axisRow = el("div", "gt-lane", null, chart);
    el("div", "gt-lane-label", null, axisRow);
    const axis = el("div", "gt-axis", null, axisRow);
    const step = Math.max(1, Math.ceil(span / DAY_MS / 5));
    for (let ms = dayMs(first); ms <= dayMs(last); ms += step * DAY_MS) {
        const date = new Date(ms).toISOString().slice(0, 10);
        el("span", "gt-tick", shortDate(date), axis).style.left = position(date);
    }

    const markers = el("div", "gt-markers", null, chart);
    const marks = [
        [started, "Started", "gt-mark-start"],
        [finished, "Finished", "gt-mark-end"],
        [!finished ? today : null, "Today", "gt-mark-today"],
        [!finished ? due : null, "Due", "gt-mark-due"],
    ];
    for (const [date, label, className] of marks) {
        if (!inRange(date)) continue;
        const mark = el("div", `gt-mark ${className}`, null, markers);
        mark.style.left = position(date);
        mark.title = `${label}: ${shortDate(date)}`;
        el("span", "gt-mark-label", label, mark);
    }
}

const shortName = (name) => (name.startsWith(`${goalName} `) ? name.slice(goalName.length + 1) : name);
const goalTag = (task, line) => {
    if (!isProject) return;
    const goal = task.goals.find((name) => scope.has(name));
    if (goal) el("span", "gt-tag", shortName(goal), line);
};

if (isProject) {
    const statusRank = { "In Progress": 0, Backlog: 1, Hold: 2, Completed: 4, Cancelled: 5 };
    const rows = pages
        .filter((page) => isType(page, "Goal") && scope.has(page.file.name))
        .map((page) => {
            const own = tasks.filter((task) => task.goals.includes(page.file.name));
            return {
                name: shortName(page.file.name),
                path: page.file.path,
                status: linkName(page["goal.status"]) || "No status",
                closed: own.filter((task) => CLOSED.has(task.status)).length,
                total: own.length,
            };
        })
        .sort((a, b) => (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3) || a.name.localeCompare(b.name));

    if (rows.length) {
        const section = el("section", "gt-goals", null, root);
        el("h4", null, "Goals", section);
        for (const row of rows) {
            const line = el("div", "gt-goal", null, section);
            noteLink(row, line, "gt-goal-name");
            const bar = el("div", "gt-bar", null, line);
            el("div", "gt-bar-fill", null, bar).style.width = `${row.total ? (row.closed / row.total) * 100 : 0}%`;
            el("span", "gt-goal-count", row.total ? `${row.closed}/${row.total}` : "no tasks", line);
            el("span", "gt-goal-status", row.status, line);
        }
    }
}

const grid = el("div", "gt-columns", null, root);

const recent = el("section", "gt-section", null, grid);
el("h4", null, "Latest work", recent);
const days = [...new Set(events.map((event) => event.date))].reverse();
const renderDay = (date, parent) => {
    const row = el("div", "gt-day", null, parent);
    el("div", "gt-day-date", shortDate(date), row);
    const items = el("ul", null, null, row);
    for (const event of events.filter((item) => item.date === date)) {
        const line = el("li", `gt-item gt-item-${event.kind}`, null, items);
        noteLink(event, line);
    }
};
days.slice(0, OPEN_DAYS).forEach((date) => renderDay(date, recent));
if (days.length > OPEN_DAYS) {
    const older = el("details", "gt-older", null, recent);
    el("summary", null, `${plural(days.length - OPEN_DAYS, "earlier day")}`, older);
    days.slice(OPEN_DAYS).forEach((date) => renderDay(date, older));
}
if (!days.length) el("p", "gt-empty", "Nothing recorded yet.", recent);

const left = el("section", "gt-section", null, grid);
el("h4", null, "What's left", left);
if (!openTasks.length) {
    el("p", "gt-empty", tasks.length ? `Nothing left. All ${plural(tasks.length, "task")} are closed.` : "No tasks planned yet.", left);
} else {
    const rank = (task) => (task.status === "In Progress" ? 0 : 1);
    const byPriority = (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name);
    const ready = openTasks.filter((task) => !task.blockers.length).sort(byPriority);
    const blocked = openTasks.filter((task) => task.blockers.length).sort(byPriority);

    el("div", "gt-status", `Ready, no known blockers (${ready.length})`, left);
    if (!ready.length) el("p", "gt-empty", "Nothing is ready.", left);
    const renderReady = (task, parent) => {
        const line = el("li", "gt-item gt-item-ready", null, parent);
        noteLink(task, line);
        if (task.status === "In Progress") el("span", "gt-tag", "in progress", line);
        goalTag(task, line);
    };
    const readyList = el("ul", null, null, left);
    ready.slice(0, READY_LIMIT).forEach((task) => renderReady(task, readyList));
    if (ready.length > READY_LIMIT) {
        const more = el("details", "gt-older", null, left);
        el("summary", null, `${ready.length - READY_LIMIT} more ready`, more);
        const moreList = el("ul", null, null, more);
        ready.slice(READY_LIMIT).forEach((task) => renderReady(task, moreList));
    }

    if (blocked.length) {
        el("div", "gt-status", `Blocked (${blocked.length})`, left);
        const blockedList = el("ul", null, null, left);
        for (const task of blocked) {
            const line = el("li", "gt-item gt-item-blocked", null, blockedList);
            noteLink(task, line);
            goalTag(task, line);
            const waiting = el("div", "gt-waiting", "waiting on ", line);
            task.blockers.forEach((blocker, index) => {
                if (index) waiting.appendChild(document.createTextNode(", "));
                if (blocker.missing) el("span", "gt-missing", `${blocker.name} (note not found)`, waiting);
                else noteLink(blocker, waiting);
            });
        }
    }
}
