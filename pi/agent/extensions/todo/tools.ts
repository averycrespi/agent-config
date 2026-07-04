import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import {
  firstLine,
  getResultText,
  getTruncatedText,
} from "../_shared/render.ts";
import { stringEnum } from "../_shared/schema.ts";
import {
  formatTodoList,
  isTodoStatus,
  type TodoStatus,
  type TodoStore,
} from "./state.ts";

const todoStatusSchema = stringEnum(
  ["todo", "in_progress", "done", "blocked"] as const,
  {
    description:
      "Task status. Use exactly one of: todo, in_progress, done, blocked.",
  },
);

const todoActionSchema = stringEnum(
  ["list", "set", "add", "update", "remove", "clear"] as const,
  {
    description:
      "Todo operation. Use exactly one of: list, set, add, update, remove, clear.",
  },
);

const todoItemInputSchema = Type.Object({
  text: Type.String({ description: "Task text" }),
  status: Type.Optional(todoStatusSchema),
  notes: Type.Optional(Type.String({ description: "Optional task notes" })),
});

const todoParamsSchema = Type.Object({
  action: todoActionSchema,
  items: Type.Optional(
    Type.Array(todoItemInputSchema, { description: "Items for set" }),
  ),
  id: Type.Optional(Type.Integer({ description: "TODO id for update/remove" })),
  text: Type.Optional(Type.String({ description: "TODO text for add/update" })),
  status: Type.Optional(todoStatusSchema),
  notes: Type.Optional(
    Type.String({ description: "TODO notes for add/update" }),
  ),
});

type TodoParams = Static<typeof todoParamsSchema>;

function textResult(text: string, store: TodoStore) {
  return {
    content: [{ type: "text" as const, text }],
    details: store.getState(),
  };
}

function errorResult(message: string, store: TodoStore) {
  return textResult(`Error: ${message}`, store);
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStatus(value: unknown): TodoStatus | undefined {
  return isTodoStatus(value) ? value : undefined;
}

function validateSetItems(items: unknown):
  | {
      ok: true;
      items: Array<{ text: string; status?: TodoStatus; notes?: string }>;
    }
  | { ok: false; message: string } {
  if (!Array.isArray(items)) {
    return { ok: false, message: "items is required for action set." };
  }

  const normalized: Array<{
    text: string;
    status?: TodoStatus;
    notes?: string;
  }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "set items must be objects." };
    }

    const text = normalizeText((item as { text?: unknown }).text);
    if (!text) {
      return { ok: false, message: "set items must include non-empty text." };
    }

    const statusValue = (item as { status?: unknown }).status;
    if (statusValue !== undefined && !isTodoStatus(statusValue)) {
      return {
        ok: false,
        message: `invalid status \"${String(statusValue)}\".`,
      };
    }

    const notesValue = (item as { notes?: unknown }).notes;
    normalized.push({
      text,
      ...(statusValue !== undefined ? { status: statusValue } : {}),
      ...(typeof notesValue === "string" ? { notes: notesValue } : {}),
    });
  }

  return { ok: true, items: normalized };
}

const STATE_ENTRY_TYPE = "todo-state";

function summarizeAction(params: TodoParams): string {
  switch (params.action) {
    case "set": {
      const count = Array.isArray(params.items) ? params.items.length : 0;
      return `set ${count} item${count === 1 ? "" : "s"}`;
    }
    case "add":
      return params.text ? `add ${JSON.stringify(params.text)}` : "add";
    case "update":
      return params.id === undefined ? "update" : `update #${params.id}`;
    case "remove":
      return params.id === undefined ? "remove" : `remove #${params.id}`;
    case "clear":
      return "clear";
    case "list":
      return "list";
  }
}

function summarizeResult(details: unknown): string {
  const items = (details as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return "✓ done";
  if (items.length === 0) return "✓ no todos";
  return `✓ ${items.length} todo${items.length === 1 ? "" : "s"}`;
}

export function registerTodoTool(pi: ExtensionAPI, store: TodoStore): void {
  function appendState(): void {
    const appendEntry = (pi as any).appendEntry;
    if (typeof appendEntry === "function") {
      appendEntry.call(pi, STATE_ENTRY_TYPE, store.getState());
    }
  }

  function mutationResult(text: string) {
    appendState();
    return textResult(text, store);
  }

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Create, replace, update, remove, clear, or list the active TODO list.",
    promptSnippet: "Manage the current ordered TODO list",
    promptGuidelines: [
      "Use todo proactively for non-trivial coding work: 3+ distinct steps, multi-file changes, explicit user task lists, or Execute-mode work from a plan.",
      "Skip todo for a single trivial step, pure conversation, or one immediate command where tracking adds no value.",
      "todo status values are exactly: todo (not started), in_progress (currently active), done (finished), blocked (waiting). Do not use pending or not_started.",
      "Before starting tracked work, create or update the list and keep exactly one item in_progress.",
      "Mark tasks done immediately after finishing them; do not batch status updates at the end.",
      "After changing a task, rely on the returned list to see current ids and ordering.",
    ],
    parameters: todoParamsSchema,
    renderCall(args, theme, context) {
      const summary = summarizeAction(args as TodoParams);
      return getTruncatedText(context.lastComponent, [
        `${theme.fg("toolTitle", theme.bold("todo"))} ${theme.fg("muted", summary)}`,
      ]);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("warning", "Updating TODOs..."),
        ]);
      }

      const text = getResultText(result);
      const message = firstLine(text);
      if (context.isError || message.startsWith("Error:")) {
        return getTruncatedText(context.lastComponent, [
          theme.fg("error", message || "todo error"),
        ]);
      }

      return getTruncatedText(context.lastComponent, [
        theme.fg("success", summarizeResult(result.details)),
      ]);
    },
    async execute(_toolCallId, rawParams, _signal, _onUpdate, _ctx) {
      const params = rawParams as TodoParams;
      switch (params.action) {
        case "list":
          return textResult(formatTodoList(store.list()), store);

        case "set": {
          const validated = validateSetItems(params.items);
          if (!validated.ok) return errorResult(validated.message, store);
          const items = store.set(validated.items);
          return mutationResult(formatTodoList(items));
        }

        case "add": {
          const text = normalizeText(params.text);
          if (!text)
            return errorResult("text is required for action add.", store);
          if (params.status !== undefined && !isTodoStatus(params.status)) {
            return errorResult(
              `invalid status \"${String(params.status)}\".`,
              store,
            );
          }
          store.add(text, normalizeStatus(params.status), params.notes);
          const items = store.list();
          return mutationResult(formatTodoList(items));
        }

        case "update": {
          if (params.id === undefined) {
            return errorResult("id is required for action update.", store);
          }
          if (params.status !== undefined && !isTodoStatus(params.status)) {
            return errorResult(
              `invalid status \"${String(params.status)}\".`,
              store,
            );
          }
          const patch: { text?: string; status?: TodoStatus; notes?: string } =
            {};
          if (params.text !== undefined) {
            const text = normalizeText(params.text);
            if (!text)
              return errorResult(
                "text must be non-empty when provided for action update.",
                store,
              );
            patch.text = text;
          }
          if (params.status !== undefined) patch.status = params.status;
          if (params.notes !== undefined) patch.notes = params.notes;
          const updated = store.update(params.id, patch);
          if (!updated)
            return errorResult(`TODO #${params.id} not found.`, store);
          return mutationResult(formatTodoList(store.list()));
        }

        case "remove": {
          if (params.id === undefined) {
            return errorResult("id is required for action remove.", store);
          }
          if (!store.remove(params.id)) {
            return errorResult(`TODO #${params.id} not found.`, store);
          }
          return mutationResult(formatTodoList(store.list()));
        }

        case "clear":
          store.clear();
          return mutationResult(formatTodoList(store.list()));
      }

      return errorResult(`unknown action \"${String(params.action)}\".`, store);
    },
  });
}
