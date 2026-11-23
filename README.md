# notes-timeline

A Dataview progress view for Obsidian. It puts completed tasks and dev logs on one time axis, then shows the latest work, ready tasks, and blocked tasks.

## Install

1. Install the Dataview community plugin and turn on **Enable JavaScript Queries**.
2. Clone this repo and copy the view into your notes folder:

   ```bash
   git clone https://github.com/Quisk/notes-timeline.git
   mkdir -p "/path/to/notes/Config/scripts/dataview"
   cp -R notes-timeline/goal-timeline "/path/to/notes/Config/scripts/dataview/"
   ```

To use a different location, change `VIEW_PATH` in `view.js` and the path in your embeds.

## Use

On a Goal or Project note:

````markdown
```dataviewjs
await dv.view("Config/scripts/dataview/goal-timeline");
```
````

On a homepage, for all active goals and projects:

````markdown
```dataviewjs
await dv.view("Config/scripts/dataview/goal-timeline", { mode: "overview" });
```
````

## Note format

Notes under `Config/` are ignored, so templates don't count as work.

```yaml
# Goal
note.type: "[[Goal]]"
goal.status: "[[In Progress]]"
goal.started: 2026-01-05
goal.dueDate: 2026-03-01
parent: "[[Website Redesign]]"

# Project
note.type: "[[Project]]"
project.status: "[[In Progress]]"

# Task
note.type: "[[Task]]"
task.status: "[[Completed]]"
task.completed: 2026-01-20
goal:
  - "[[Launch the New Homepage]]"

# Log
note.type: "[[Log]]"
note.created: 2026-01-20
goal:
  - "[[Launch the New Homepage]]"
related:
  - "[[Draft the Homepage Copy]]"
```

Projects also use `project.started`, `project.completed`, and `project.dueDate`. Goals use `goal.completed`.

To mark a task as blocked, add a line to its body:

```markdown
Depends on: [[Draft the Homepage Copy]], [[Choose a Color Palette]]
```

## License

MIT
