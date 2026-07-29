const patch = (value) => value.trim();

export const todoDemoChange = {
  title: "Add filters, due dates, and saved todos",
  number: 42,
  summary:
    "Adds the basic pieces of a useful todo list: persistent tasks, completion controls, filters, due dates, and focused tests.",
  why:
    "The first version lost tasks on refresh and treated every item the same. This change makes the small app useful across sessions and keeps finished work out of the way.",
  highlights: [
    "Persists todos in local storage and restores them on load.",
    "Adds active, completed, and all-task filters.",
    "Adds due dates, priorities, completion styles, and reducer tests.",
  ],
  risks: [
    "Stored todos from older versions need safe defaults for new fields.",
    "Date-only values must not shift when the browser applies a time zone.",
  ],
};

export const todoDemoFiles = [
  {
    path: "src/components/TodoItem.tsx",
    status: "modified",
    additions: 12,
    deletions: 3,
    patch: patch(`
diff --git a/src/components/TodoItem.tsx b/src/components/TodoItem.tsx
index e86c1ab..d3b508a 100644
--- a/src/components/TodoItem.tsx
+++ b/src/components/TodoItem.tsx
@@ -8,8 +8,17 @@ type Props = {
 export function TodoItem({ todo, onToggle }: Props) {
   return (
-    <li className="todo-item">
-      <button onClick={() => onToggle(todo.id)}>Done</button>
-      <span>{todo.title}</span>
+    <li className={todo.completed ? "todo-item is-complete" : "todo-item"}>
+      <label className="todo-check">
+        <input
+          type="checkbox"
+          checked={todo.completed}
+          onChange={() => onToggle(todo.id)}
+        />
+        <span>{todo.title}</span>
+      </label>
+      {todo.dueDate ? (
+        <time dateTime={todo.dueDate}>{formatDueDate(todo.dueDate)}</time>
+      ) : null}
     </li>
   );
 }
`),
    summary: {
      title: "Make completion a clear state",
      what:
        "Replaces the generic Done button with a checked control and shows an optional due date beside each todo.",
      why:
        "A todo should expose its current completion state without making the reader infer it from a button label.",
      details: [
        "The checked state now comes from todo.completed.",
        "The due date uses a semantic time element.",
      ],
      risks: [
        "formatDueDate must treat the stored value as a local date, not UTC.",
      ],
    },
  },
  {
    path: "src/components/TodoList.tsx",
    status: "modified",
    additions: 13,
    deletions: 6,
    patch: patch(`
diff --git a/src/components/TodoList.tsx b/src/components/TodoList.tsx
index 2620e53..498407f 100644
--- a/src/components/TodoList.tsx
+++ b/src/components/TodoList.tsx
@@ -4,13 +4,20 @@ import { TodoItem } from "./TodoItem";
 export function TodoList({ todos, filter, onToggle }: Props) {
-  if (!todos.length) {
-    return <p>No todos yet.</p>;
-  }
+  const visibleTodos = todos.filter((todo) => {
+    if (filter === "active") return !todo.completed;
+    if (filter === "completed") return todo.completed;
+    return true;
+  });
 
   return (
-    <ul className="todo-list">
-      {todos.map((todo) => (
+    <section aria-live="polite">
+      {!visibleTodos.length ? (
+        <p className="empty-todos">No todos match this filter.</p>
+      ) : null}
+      <ul className="todo-list">
+      {visibleTodos.map((todo) => (
         <TodoItem key={todo.id} todo={todo} onToggle={onToggle} />
       ))}
-    </ul>
+      </ul>
+    </section>
   );
 }
`),
    summary: {
      title: "Filter the visible todo list",
      what:
        "Derives the shown todos from the selected filter and gives an empty filter a useful message.",
      why:
        "Completed items should be easy to hide without changing the stored list.",
      details: [
        "All, active, and completed views share one source array.",
        "The list announces filter results without moving focus.",
      ],
      risks: [
        "The filter names must stay aligned with the FilterBar values.",
      ],
    },
  },
  {
    path: "src/components/AddTodoForm.tsx",
    status: "modified",
    additions: 13,
    deletions: 3,
    patch: patch(`
diff --git a/src/components/AddTodoForm.tsx b/src/components/AddTodoForm.tsx
index 2c5e70f..06a9971 100644
--- a/src/components/AddTodoForm.tsx
+++ b/src/components/AddTodoForm.tsx
@@ -9,15 +9,25 @@ export function AddTodoForm({ onAdd }: Props) {
   const [title, setTitle] = useState("");
+  const [dueDate, setDueDate] = useState("");
 
   function submit(event: FormEvent) {
     event.preventDefault();
-    onAdd(title);
+    const cleanTitle = title.trim();
+    if (!cleanTitle) return;
+    onAdd({ title: cleanTitle, dueDate: dueDate || undefined });
     setTitle("");
+    setDueDate("");
   }
 
   return (
     <form onSubmit={submit}>
-      <input value={title} onChange={(event) => setTitle(event.target.value)} />
-      <button>Add</button>
+      <input
+        value={title}
+        onChange={(event) => setTitle(event.target.value)}
+        placeholder="What needs doing?"
+        aria-label="Todo title"
+      />
+      <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
+      <button disabled={!title.trim()}>Add todo</button>
     </form>
   );
 }
`),
    summary: {
      title: "Reject blank todos at the form",
      what:
        "Trims the title, disables empty submission, and lets a new todo carry an optional due date.",
      why:
        "Blank rows create cleanup work and make the list feel broken.",
      details: [
        "Both fields reset after a successful add.",
        "The title input has a clear accessible name.",
      ],
      risks: [
        "The date input needs a visible label in the final form layout.",
      ],
    },
  },
  {
    path: "src/hooks/useTodos.ts",
    status: "modified",
    additions: 19,
    deletions: 4,
    patch: patch(`
diff --git a/src/hooks/useTodos.ts b/src/hooks/useTodos.ts
index 6bbf15c..f786fb1 100644
--- a/src/hooks/useTodos.ts
+++ b/src/hooks/useTodos.ts
@@ -1,9 +1,24 @@
-import { useState } from "react";
+import { useEffect, useReducer } from "react";
+import { todoReducer } from "../lib/todoStore";
 
 export function useTodos() {
-  const [todos, setTodos] = useState<Todo[]>([]);
+  const [todos, dispatch] = useReducer(
+    todoReducer,
+    [],
+    () => {
+      const saved = localStorage.getItem("todos");
+      return saved ? JSON.parse(saved) : [];
+    },
+  );
 
-  const addTodo = (title: string) => setTodos([...todos, createTodo(title)]);
+  useEffect(() => {
+    localStorage.setItem("todos", JSON.stringify(todos));
+  }, [todos]);
 
-  return { todos, addTodo };
+  return {
+    todos,
+    addTodo: (input: NewTodo) => dispatch({ type: "added", input }),
+    toggleTodo: (id: string) => dispatch({ type: "toggled", id }),
+    removeTodo: (id: string) => dispatch({ type: "removed", id }),
+  };
 }
`),
    summary: {
      title: "Keep todos after refresh",
      what:
        "Moves todo updates into a reducer, restores saved items on first load, and saves each later change.",
      why:
        "A useful todo list cannot discard its contents whenever the page reloads.",
      details: [
        "The lazy reducer initializer reads storage only once.",
        "All writes flow through named reducer actions.",
      ],
      risks: [
        "Malformed stored JSON currently stops initialization and needs a fallback.",
      ],
    },
  },
  {
    path: "src/lib/todoStore.ts",
    status: "added",
    additions: 30,
    deletions: 0,
    patch: patch(`
diff --git a/src/lib/todoStore.ts b/src/lib/todoStore.ts
new file mode 100644
index 0000000..9f7006c
--- /dev/null
+++ b/src/lib/todoStore.ts
@@ -0,0 +1,30 @@
+import type { NewTodo, Todo, TodoAction } from "../types/todo";
+
+export function todoReducer(todos: Todo[], action: TodoAction): Todo[] {
+  if (action.type === "added") {
+    return [
+      ...todos,
+      {
+        id: crypto.randomUUID(),
+        title: action.input.title,
+        completed: false,
+        dueDate: action.input.dueDate,
+        priority: action.input.priority ?? "normal",
+      },
+    ];
+  }
+
+  if (action.type === "toggled") {
+    return todos.map((todo) =>
+      todo.id === action.id
+        ? { ...todo, completed: !todo.completed }
+        : todo,
+    );
+  }
+
+  if (action.type === "removed") {
+    return todos.filter((todo) => todo.id !== action.id);
+  }
+
+  return todos;
+}
`),
    summary: {
      title: "Put todo updates in one reducer",
      what:
        "Adds pure add, toggle, and remove transitions for the todo collection.",
      why:
        "Central state transitions are easier to test and keep storage writes separate from list logic.",
      details: [
        "New todos receive an id, default completion state, and normal priority.",
        "Every action returns a new array.",
      ],
      risks: [
        "crypto.randomUUID needs a fallback in older browsers and some test runners.",
      ],
    },
  },
  {
    path: "src/types/todo.ts",
    status: "modified",
    additions: 14,
    deletions: 1,
    patch: patch(`
diff --git a/src/types/todo.ts b/src/types/todo.ts
index 25e13c0..a4066ed 100644
--- a/src/types/todo.ts
+++ b/src/types/todo.ts
@@ -1,5 +1,18 @@
 export type Todo = {
   id: string;
   title: string;
-  done: boolean;
+  completed: boolean;
+  dueDate?: string;
+  priority: "low" | "normal" | "high";
 };
+
+export type NewTodo = Pick<Todo, "title" | "dueDate"> & {
+  priority?: Todo["priority"];
+};
+
+export type TodoFilter = "all" | "active" | "completed";
+
+export type TodoAction =
+  | { type: "added"; input: NewTodo }
+  | { type: "toggled"; id: string }
+  | { type: "removed"; id: string };
`),
    summary: {
      title: "Describe richer todo state",
      what:
        "Renames the completion field and adds due dates, priorities, filters, and reducer action types.",
      why:
        "The UI and reducer need one shared contract for the new behavior.",
      details: [
        "NewTodo permits a missing priority so the reducer can supply a default.",
        "Filter values form a closed string union.",
      ],
      risks: [
        "Existing saved items still use done and need a small migration.",
      ],
    },
  },
  {
    path: "src/styles/todos.css",
    status: "modified",
    additions: 24,
    deletions: 2,
    patch: patch(`
diff --git a/src/styles/todos.css b/src/styles/todos.css
index 11e4c3a..ccdf474 100644
--- a/src/styles/todos.css
+++ b/src/styles/todos.css
@@ -12,7 +12,29 @@
 .todo-item {
   align-items: center;
-  border-bottom: 1px solid #ddd;
+  border-bottom: 1px solid #d8d1c4;
   display: flex;
+  gap: 16px;
   justify-content: space-between;
-  padding: 8px;
+  padding: 14px 0;
+}
+
+.todo-check {
+  align-items: center;
+  display: flex;
+  gap: 10px;
+}
+
+.todo-item time {
+  color: #73766d;
+  font-size: 12px;
+}
+
+.todo-item.is-complete span {
+  color: #8b8d86;
+  text-decoration: line-through;
+}
+
+.empty-todos {
+  color: #73766d;
+  padding: 32px 0;
 }
`),
    summary: {
      title: "Show completed work quietly",
      what:
        "Adds spacing, due-date text, a muted completed state, and a calm empty message.",
      why:
        "Completion needs to remain visible without competing with active work.",
      details: [
        "The row keeps its simple ruled-list structure.",
        "The completed state changes both color and decoration.",
      ],
      risks: [],
    },
  },
  {
    path: "src/components/FilterBar.tsx",
    status: "added",
    additions: 21,
    deletions: 0,
    patch: patch(`
diff --git a/src/components/FilterBar.tsx b/src/components/FilterBar.tsx
new file mode 100644
index 0000000..b3372f1
--- /dev/null
+++ b/src/components/FilterBar.tsx
@@ -0,0 +1,21 @@
+import type { TodoFilter } from "../types/todo";
+
+const filters: TodoFilter[] = ["all", "active", "completed"];
+
+export function FilterBar({ value, onChange }: Props) {
+  return (
+    <div className="filter-bar" aria-label="Filter todos">
+      {filters.map((filter) => (
+        <button
+          key={filter}
+          type="button"
+          className={value === filter ? "is-active" : ""}
+          aria-pressed={value === filter}
+          onClick={() => onChange(filter)}
+        >
+          {filter[0].toUpperCase() + filter.slice(1)}
+        </button>
+      ))}
+    </div>
+  );
+}
`),
    summary: {
      title: "Add direct list filters",
      what:
        "Adds three pressed-state controls for all, active, and completed todos.",
      why:
        "People need a quick way to focus on unfinished work or review what they completed.",
      details: [
        "aria-pressed exposes the current filter to assistive technology.",
        "The values come from the shared TodoFilter type.",
      ],
      risks: [
        "The Props type must be added or imported before this component compiles.",
      ],
    },
  },
  {
    path: "src/lib/todoStore.test.ts",
    status: "added",
    additions: 32,
    deletions: 0,
    patch: patch(`
diff --git a/src/lib/todoStore.test.ts b/src/lib/todoStore.test.ts
new file mode 100644
index 0000000..b20af2c
--- /dev/null
+++ b/src/lib/todoStore.test.ts
@@ -0,0 +1,32 @@
+import { describe, expect, it, vi } from "vitest";
+import { todoReducer } from "./todoStore";
+
+describe("todoReducer", () => {
+  it("adds a todo with safe defaults", () => {
+    vi.stubGlobal("crypto", { randomUUID: () => "todo-1" });
+
+    const todos = todoReducer([], {
+      type: "added",
+      input: { title: "Buy oat milk" },
+    });
+
+    expect(todos).toEqual([
+      {
+        id: "todo-1",
+        title: "Buy oat milk",
+        completed: false,
+        dueDate: undefined,
+        priority: "normal",
+      },
+    ]);
+  });
+
+  it("toggles only the chosen todo", () => {
+    const first = makeTodo({ id: "one", completed: false });
+    const second = makeTodo({ id: "two", completed: false });
+
+    expect(
+      todoReducer([first, second], { type: "toggled", id: "two" }),
+    ).toEqual([first, { ...second, completed: true }]);
+  });
+});
`),
    summary: {
      title: "Lock down reducer behavior",
      what:
        "Tests new-todo defaults and confirms toggling leaves unrelated items unchanged.",
      why:
        "The reducer now owns every todo transition and needs fast tests around its core rules.",
      details: [
        "The id source is stubbed for a stable add assertion.",
        "The toggle test checks both the changed and unchanged entries.",
      ],
      risks: [
        "The global crypto stub should be restored after each test.",
      ],
    },
  },
  {
    path: "README.md",
    status: "modified",
    additions: 12,
    deletions: 2,
    patch: patch(`
diff --git a/README.md b/README.md
index f2f695a..d5512c1 100644
--- a/README.md
+++ b/README.md
@@ -8,4 +8,14 @@ npm run dev
 
-Add a todo, mark it done, or remove it.
+Add a todo, give it a due date, and mark it complete.
 
-Todos reset when the page reloads.
+Todos are saved in local storage and return after a reload.
+
+## Filters
+
+Use the list controls to show:
+
+- All todos
+- Active todos
+- Completed todos
+
+The app keeps filter state in memory and never removes hidden todos.
`),
    summary: {
      title: "Document the useful todo flow",
      what:
        "Updates the quick guide for due dates, saved todos, and the three list filters.",
      why:
        "The README should match the behavior a new contributor sees after starting the app.",
      details: [
        "It states that filtering hides rather than deletes todos.",
        "It explains that persistence uses local storage.",
      ],
      risks: [],
    },
  },
].map((file) => ({
  ...file,
  isBinary: false,
  isTruncated: false,
  totalDiffLines: file.patch.split("\n").length,
  snippet: file.patch,
}));
