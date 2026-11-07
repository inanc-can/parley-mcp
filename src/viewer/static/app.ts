import { unknown, type infer as Infer, type ZodMiniType } from "zod/mini";
import {
  errorSchema,
  groupMessages,
  receiptLabel,
  stateSchema,
  threadViewSchema,
  type Agreement,
  type MessageGroup,
  type State,
  type ThreadSummary,
  type ThreadView,
} from "./views.js";

/**
 * The Parley viewer page (PLAN section 8). Plain DOM: every agent-written
 * string goes in through textContent, never innerHTML. The server pushes a
 * `change` event over SSE; the page then refetches what it shows.
 */

const token = new URLSearchParams(location.search).get("token") ?? "";
let state: State | null = null;
let selected: string | null = new URLSearchParams(location.hash.slice(1)).get("thread");
let posting = false;
/** Action replies are not shown; only a refetch of the state is. */
const okSchema = unknown();

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) {
    throw new Error(`missing #${id}`);
  }
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string } = {},
  children: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className !== undefined) {
    node.className = props.className;
  }
  if (props.text !== undefined) {
    node.textContent = props.text;
  }
  if (props.title !== undefined) {
    node.title = props.title;
  }
  for (const child of children) {
    if (child !== null) {
      node.append(child);
    }
  }
  return node;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { className: `btn ${className}`, text });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

async function api<S extends ZodMiniType>(path: string, schema: S, init?: RequestInit): Promise<Infer<S>> {
  const headers = new Headers(init?.headers);
  headers.set("x-parley-token", token);
  if (init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const json: unknown = await res.json();
  if (!res.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new Error(parsed.success ? (parsed.data.detail ?? parsed.data.error) : `HTTP ${String(res.status)}`);
  }
  return schema.parse(json);
}

function showError(message: string | null): void {
  const box = byId("error", HTMLDivElement);
  box.hidden = message === null;
  box.textContent = message ?? "";
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderState(s: State): void {
  byId("repo", HTMLSpanElement).textContent = s.repoRoot;
  byId("repo", HTMLSpanElement).title = s.repoRoot;
  byId("stop-all", HTMLInputElement).checked = s.stopAll;
  byId("stop-banner", HTMLDivElement).hidden = !s.stopAll;

  const agents = byId("agents", HTMLUListElement);
  agents.replaceChildren(
    ...(s.agents.length === 0
      ? [el("li", { className: "muted", text: "No agents yet." })]
      : s.agents.map((a) =>
          el("li", { className: "agent" }, [
            el("span", { className: a.alive ? "dot alive" : "dot", title: a.alive ? "alive" : "idle" }),
            el("span", { text: a.id }),
            el("span", { className: "muted", text: a.alive ? "alive" : "idle" }),
          ]),
        )),
  );

  const threads = byId("threads", HTMLUListElement);
  threads.replaceChildren(
    ...(s.threads.length === 0
      ? [el("li", { className: "muted", text: "No conversations yet." })]
      : s.threads.map((t) => el("li", {}, [threadItem(t)]))),
  );
}

function threadItem(t: ThreadSummary): HTMLButtonElement {
  const item = el("button", { className: t.id === selected ? "thread-item selected" : "thread-item" }, [
    el("span", { className: "title", text: t.title }),
    t.lastMessage === null ? null : el("span", { className: "preview", text: `${t.lastMessage.from}: ${t.lastMessage.preview}` }),
    el("span", { className: "meta" }, [
      t.status === "open" ? null : el("span", { className: `pill ${t.status}`, text: t.status }),
      t.lastMessage === null ? null : el("span", { text: receiptLabel(t.lastMessage.status) }),
      el("span", { text: `${String(t.messageCount)}/${String(t.messageCap)} msgs` }),
      el("span", { text: `≈${String(t.estTokens)} tokens` }),
    ]),
  ]);
  item.type = "button";
  item.addEventListener("click", () => {
    select(t.id);
  });
  return item;
}

function renderThread(view: ThreadView | null): void {
  const pane = byId("thread", HTMLElement);
  const layout = byId("layout", HTMLElement);
  layout.classList.toggle("show-thread", view !== null);
  if (view === null) {
    pane.replaceChildren(el("p", { className: "empty muted", text: "Pick a thread to see the conversation." }));
    return;
  }
  const t = view.thread;
  const actions = el("div", { className: "thread-actions" }, [
    t.status === "open" ? button("Pause", "", () => void act(`/api/threads/${t.id}/pause`)) : null,
    t.status === "paused" ? button("Resume (+20)", "primary", () => void act(`/api/threads/${t.id}/resume`)) : null,
    t.status === "closed" ? null : button("Close", "danger", () => void act(`/api/threads/${t.id}/close`)),
  ]);
  const head = el("div", { className: "thread-head" }, [
    button("← Threads", "back ghost", () => {
      select(null);
    }),
    el("h1", { text: t.title }),
    el("span", { className: `pill ${t.status}`, text: t.status }),
    actions,
  ]);
  const meta = el("div", { className: "meta" }, [
    el("span", { text: `${String(t.messageCount)}/${String(t.messageCap)} messages` }),
    el("span", { text: `≈${String(t.estTokens)} tokens` }),
  ]);
  const messages = el(
    "div",
    { className: "messages" },
    view.messages.length === 0 ? [el("p", { className: "muted", text: "No messages." })] : groupMessages(view.messages).map(messageBubble),
  );
  const agreements =
    view.agreements.length === 0
      ? null
      : el("div", { className: "agreements" }, [el("h2", { text: "Agreements" }), ...view.agreements.map(agreementCard)]);
  pane.replaceChildren(head, meta, messages, agreements ?? el("span"), composer(t));
}

function messageBubble(g: MessageGroup): HTMLDivElement {
  const role = g.from === "you" ? "you" : g.from === "system" ? "system" : "";
  const recipients = g.rows.map((r) => r.to).join(", ");
  return el("div", { className: `msg ${role}` }, [
    el("div", { className: "msg-head" }, [
      el("strong", { text: g.from }),
      el("span", { text: `→ ${recipients}` }),
      el("span", { text: `· ${time(g.sentAt)}` }),
      el("span", { text: `· ≈${String(g.estTokens)} tokens` }),
    ]),
    el("p", { className: "msg-body", text: g.body }),
    el(
      "div",
      { className: "receipts" },
      g.rows.map((r) =>
        el("span", {
          className: `receipt ${r.status}`,
          text: g.rows.length > 1 ? `${r.to}: ${receiptLabel(r.status)}` : receiptLabel(r.status),
          title: receiptTitle(r.deliveredAt, r.readAt, r.repliedAt),
        }),
      ),
    ),
  ]);
}

function receiptTitle(delivered: number | null, read: number | null, replied: number | null): string {
  const parts: string[] = [];
  if (delivered !== null) parts.push(`delivered ${time(delivered)}`);
  if (read !== null) parts.push(`read ${time(read)}`);
  if (replied !== null) parts.push(`replied ${time(replied)}`);
  return parts.join(", ");
}

function agreementCard(a: Agreement): HTMLDivElement {
  return el("div", { className: "agreement" }, [
    el("div", { className: "meta" }, [
      el("span", { className: `pill ${a.status}`, text: a.status }),
      el("span", { text: `${a.offeredBy} → ${a.offeredTo}` }),
      el("span", { text: time(a.createdAt) }),
    ]),
    el("p", { text: a.text }),
    a.status === "accepted"
      ? button("Veto", "danger", () => {
          if (confirm("Veto this agreement? Both agents will be told it no longer holds.")) {
            void act(`/api/agreements/${a.id}/veto`);
          }
        })
      : null,
  ]);
}

function composer(t: ThreadSummary): HTMLFormElement {
  const form = el("form", { className: "composer" });
  if (t.status === "closed") {
    form.append(el("p", { className: "muted", text: "This thread is closed." }));
    return form;
  }
  const box = el("textarea");
  box.placeholder = "Write to the agents in this thread as “you”…";
  box.maxLength = 20_000;
  const send = button("Post as you", "primary", () => undefined);
  send.type = "submit";
  form.append(box, el("div", { className: "composer-row" }, [el("span", { className: "muted", text: "Every agent in the thread gets it." }), send]));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = box.value.trim();
    if (text.length === 0 || posting) {
      return;
    }
    posting = true;
    send.disabled = true;
    void act(`/api/threads/${t.id}/messages`, { text, idempotency_key: crypto.randomUUID() }).then((ok) => {
      posting = false;
      send.disabled = false;
      if (ok) {
        box.value = "";
      }
    });
  });
  return form;
}

async function act(path: string, body: unknown = {}): Promise<boolean> {
  try {
    await api(path, okSchema, {
      method: "POST",
      body: JSON.stringify(body),
    });
    showError(null);
    await refresh();
    return true;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function select(threadId: string | null): void {
  selected = threadId;
  history.replaceState(null, "", threadId === null ? location.pathname + location.search : `#thread=${threadId}`);
  void refresh();
}

async function refresh(): Promise<void> {
  try {
    state = await api("/api/state", stateSchema);
    renderState(state);
    if (selected !== null && state.threads.some((t) => t.id === selected)) {
      // Keep a half-written post: only re-render the thread when not typing.
      const typing = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.value.length > 0;
      if (!typing) {
        renderThread(await api(`/api/threads/${encodeURIComponent(selected)}`, threadViewSchema));
      }
    } else {
      renderThread(null);
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function connect(): void {
  const live = byId("live", HTMLSpanElement);
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener("ready", () => {
    live.textContent = "live";
    live.classList.add("on");
    void refresh();
  });
  events.addEventListener("change", () => void refresh());
  events.addEventListener("error", () => {
    live.textContent = "reconnecting…";
    live.classList.remove("on");
  });
}

function init(): void {
  byId("export-md", HTMLAnchorElement).href = `/api/export?format=md&token=${encodeURIComponent(token)}`;
  byId("export-jsonl", HTMLAnchorElement).href = `/api/export?format=jsonl&token=${encodeURIComponent(token)}`;
  byId("stop-all", HTMLInputElement).addEventListener("change", (event) => {
    const on = event.target instanceof HTMLInputElement && event.target.checked;
    void act("/api/stop-all", { on });
  });
  void refresh();
  connect();
}

init();
