// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Context } from "@deepseek-ai/cordis";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  fixture,
  owners,
  id,
  other,
  scope,
  outsider,
  agent,
} from "../../app/shell/sidebar-testing";
import { stubAvatarBrowserApis } from "../agents/avatar-testing";
import { SoloNavigationService } from "./solo-navigation";
import type { SoloTaskRow, SoloEnhancement } from "./solo-navigation-contract";
import { SoloHeading } from "../../bundled/channels/SoloHeading";
import { WorkspaceControl } from "../solo/WorkspaceControl";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { conversationTarget, soloDraftTarget } from "./routes";
import { readView, writeView } from "../../shared/view-state";
stubAvatarBrowserApis();
const contexts: Context[] = [];
afterEach(async () => {
  cleanup();
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  for (const owner of owners.splice(0)) owner.dispose();
  localStorage.clear();
});
async function enhancedFixture(rows: readonly SoloTaskRow[], newer = 0) {
  const root = new Context();
  contexts.push(root);
  root.provide("pluginStatus", {
    isActive: () => true,
    subscribe: () => () => {},
  });
  let service: SoloNavigationService | undefined;
  const f = fixture(
    true,
    false,
    undefined,
    undefined,
    newer,
    undefined,
    (relay) => (service = new SoloNavigationService(root, relay)),
  );
  let revision = 0;
  let changed = () => {};
  const run = vi.fn();
  const descriptor: SoloEnhancement = {
    id: "tasks",
    title: "Nexus",
    childNoun: { one: "Worker", other: "Workers" },
    dataRevision: () => revision,
    subscribe(listener) {
      changed = listener;
      return () => {
        changed = () => {};
      };
    },
    read: () => ({ rows }),
    create: { label: "New task…", run },
  };
  const fiber = root
    .extend({ pluginOwner: { id: "test.tasks", revision: "one" } })
    .plugin((ctx) => ctx.soloNavigation.register(descriptor));
  await act(async () => {
    await fiber.await();
  });
  return {
    ...f,
    service,
    run,
    disable: () => act(async () => fiber.dispose()),
    replace: () =>
      act(async () => {
        await root
          .extend({ pluginOwner: { id: "replacement", revision: "two" } })
          .plugin((ctx) =>
            ctx.soloNavigation.register({ ...descriptor, order: -1 }),
          )
          .await();
      }),
    update(next: readonly SoloTaskRow[]) {
      act(() => {
        rows = next;
        revision++;
        changed();
      });
    },
  };
}
const parent: SoloTaskRow = {
  channelId: id,
  status: "running",
  subtitle: "Build sidebar",
  details: [{ label: "Branch", value: "task/sidebar" }],
};
const child: SoloTaskRow = {
  channelId: other,
  parentChannelId: id,
  status: "waiting",
};

it("shows one enhanced Solo inventory, keeps ordinary recovery controls, and restores all names on disable", async () => {
  const user = userEvent.setup();
  const f = await enhancedFixture([parent]);
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "All",
    "Team",
    "Nexus",
  ]);
  expect(
    screen.getByRole("navigation", { name: "Nexus conversations" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Planning/ })).toHaveTextContent(
    "Build sidebar",
  );
  await user.click(screen.getByRole("button", { name: "Group and sort" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "All tasks" }),
  );
  await user.keyboard("{Escape}");
  // Finish the old popup's focus restoration before opening its sibling.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Group and sort" }),
    ).toHaveFocus(),
  );
  expect(screen.getByRole("button", { name: /^Other/ })).toHaveTextContent(
    "Open chat — outside filter",
  );
  await user.click(
    screen.getByRole("button", { name: "New chat or workspace" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "New task…" }));
  expect(f.run).toHaveBeenCalledOnce();
  await f.disable();
  expect(screen.getByRole("tab", { name: "Solo" })).toBeInTheDocument();
  expect(
    screen.getByRole("navigation", { name: "Solo conversations" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Group and sort" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /^Planning/ }),
  ).not.toHaveTextContent("Running");
});

it("keeps branch expansion during parent/worker selection, respects explicit close, and resets on outside conversations", async () => {
  const user = userEvent.setup();
  const f = await enhancedFixture([parent, child], 1);
  // The initially current child retains its parent context, without selecting it.
  const row = screen.getByRole("button", { name: /^Planning/ });
  expect(row).not.toHaveAttribute("aria-current");
  expect(row).not.toHaveTextContent("Contains current task");
  expect(row).toHaveTextContent("task/sidebar");
  let workers = screen.getByRole("button", { name: /1 worker:/i });
  expect(workers.closest("[data-navigation-card]")).toContainElement(row);
  expect(workers.closest("[data-navigation-card]")).toContainElement(
    screen.getByRole("button", { name: /^Other/ }),
  );
  expect(workers.closest("button")).toBe(workers);
  expect(workers).toHaveAttribute("aria-expanded", "true");
  await user.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-current", "page"));
  expect(workers).toHaveAttribute("aria-expanded", "true");
  // Retained nested disclosures stay visible when selection returns to the root.
  f.update([
    parent,
    child,
    { channelId: "newer-0", parentChannelId: other, status: "done" },
  ]);
  await act(async () => {
    await f.navigator.open(conversationTarget(scope, "newer-0"));
  });
  const descendant = screen.getByRole("button", { name: /^Newer 0/ });
  expect(descendant).toHaveAttribute("aria-current", "page");
  await user.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-current", "page"));
  expect(descendant).toBeVisible();
  const nestedDisclosure = screen.getByRole("button", {
    name: /1 worker: 1 done/i,
  });
  expect(nestedDisclosure).toHaveAttribute("aria-expanded", "true");
  await user.click(nestedDisclosure);
  expect(
    screen.queryByRole("button", { name: /^Newer 0/ }),
  ).not.toBeInTheDocument();
  expect(nestedDisclosure).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Other/ })).toHaveFocus();
  expect(workers).toHaveAttribute("aria-expanded", "true");
  f.update([parent, child]);
  const initiallyCurrentWorker = screen.getByRole("button", { name: /^Other/ });
  await user.click(initiallyCurrentWorker);
  await waitFor(() =>
    expect(initiallyCurrentWorker).toHaveAttribute("aria-current", "page"),
  );
  await user.click(workers);
  expect(
    screen.queryByRole("button", { name: /^Other/ }),
  ).not.toBeInTheDocument();
  f.update([parent, child]);
  expect(workers).toHaveAttribute("aria-expanded", "false");
  f.navigationStatus("failed");
  expect(workers).toHaveAttribute("aria-expanded", "false");
  f.navigationStatus("opened");
  expect(workers).toHaveAttribute("aria-expanded", "true");
  await user.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-current", "page"));
  expect(screen.getByText("task/sidebar")).toBeInTheDocument();
  expect(workers).toHaveAttribute("aria-expanded", "true");
  const selectedWorker = screen.getByRole("button", { name: /^Other/ });
  await user.click(selectedWorker);
  await waitFor(() =>
    expect(selectedWorker).toHaveAttribute("aria-current", "page"),
  );
  expect(workers).toHaveAttribute("aria-expanded", "true");
  await user.click(workers);
  await user.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-current", "page"));
  expect(workers).toHaveAttribute("aria-expanded", "false");
  await user.click(workers);
  const ordinary = screen.getByRole("button", { name: "Newer 0" });
  await user.click(ordinary);
  await waitFor(() => expect(ordinary).toHaveAttribute("aria-current", "page"));
  await user.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-current", "page"));
  workers = screen.getByRole("button", { name: /1 worker:/i });
  expect(workers).toHaveAttribute("aria-expanded", "false");
  await user.click(workers);
  f.update([parent, child, { channelId: "newer-0", status: "done" }]);
  const otherRoot = screen.getByRole("button", { name: /^Newer 0/ });
  await user.click(otherRoot);
  await waitFor(() =>
    expect(otherRoot).toHaveAttribute("aria-current", "page"),
  );
  await user.click(row);
  await waitFor(() => expect(row).toHaveAttribute("aria-current", "page"));
  workers = screen.getByRole("button", { name: /1 worker:/i });
  expect(workers).toHaveAttribute("aria-expanded", "false");
  await act(async () => {
    await f.navigator.open(soloDraftTarget(scope));
  });
  expect(
    screen.queryByRole("button", { name: /workers?:/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^Other/ }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await f.navigator.open(conversationTarget(scope, other));
  });
  expect(screen.getByRole("button", { name: /^Other/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  f.update([parent, { channelId: other, status: "waiting" }]);
  expect(
    screen.queryByRole("button", { name: /workers?:/i }),
  ).not.toBeInTheDocument();
  f.update([parent, child]);
  expect(screen.getByRole("button", { name: /workers?:/i })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

it.each(["sidebar", "header"])(
  "revalidates the %s New workspace dialog before it can create or assign",
  async (surface) => {
    const user = userEvent.setup();
    const f = await enhancedFixture([
      parent,
      { channelId: other, status: "waiting" },
    ]);
    const assign = vi.fn(async () => {}),
      createAndAssign = vi.fn(async () => {});
    const preferences = {
      status: "ready" as const,
      data: {
        sections: [{ id: "work", name: "Work", order: 0 }],
        assignments: {},
        starred: [],
        muted: [],
      },
    };
    act(() =>
      Object.assign(f.session.soloPreferences, {
        writable: true,
        sectionCreationWritable: true,
        snapshot: () => preferences,
        assign,
        createAndAssign,
      }),
    );
    f.update([parent, { channelId: other, status: "waiting" }]);
    if (surface === "header") {
      const channel = f.session.channels
        .list()
        .channels.find((channel) => channel.id === other);
      if (!channel) throw new Error("Missing chat");
      render(
        <ToastProvider>
          <SoloHeading
            session={f.session}
            scope={scope}
            channel={channel}
            navigator={f.navigator}
            onConvert={() => {}}
            onLifecycle={() => {}}
          />
        </ToastProvider>,
      );
    }
    await user.click(
      screen.getByRole("button", {
        name: surface === "sidebar" ? "Actions for Other" : "Chat actions",
      }),
    );
    const move = await screen.findByRole("menuitem", { name: "Move to" });
    move.focus();
    await user.keyboard("{ArrowRight}");
    const create = await screen.findByRole("menuitem", {
      name: "New workspace…",
    });
    create.focus();
    await user.keyboard("{Enter}");
    await user.type(
      screen.getByRole("textbox", { name: "Workspace name" }),
      "Should not exist",
    );
    f.update([parent, child]);
    expect(
      screen.getByRole("dialog", { name: "Create new workspace" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create and move" }));
    expect(
      screen.queryByRole("dialog", { name: "Create new workspace" }),
    ).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(createAndAssign).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Workspace follows Planning"),
    ).toBeInTheDocument();
  },
);

it("closes the saved workspace chooser when metadata makes its chat nested and restores ordinary placement on disable", async () => {
  const user = userEvent.setup();
  const f = await enhancedFixture([
    parent,
    { channelId: other, status: "waiting" },
  ]);
  const assign = vi.fn(async () => {});
  const preferences = {
    status: "ready" as const,
    data: {
      sections: [{ id: "work", name: "Work", order: 0 }],
      assignments: { [other]: "work" },
      starred: [],
      muted: [],
    },
  };
  act(() =>
    Object.assign(f.session.soloPreferences, {
      writable: true,
      snapshot: () => preferences,
      assign,
    }),
  );
  f.update([parent, { channelId: other, status: "waiting" }]);
  render(<WorkspaceControl session={f.session} channelId={other} />);
  await user.click(screen.getByRole("button", { name: "Workspace: Work" }));
  expect(
    await screen.findByRole("menuitemradio", { name: "No workspace" }),
  ).toBeInTheDocument();
  f.update([parent, child]);
  expect(
    screen.queryByRole("menuitemradio", { name: "No workspace" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Workspace follows Planning")).toBeInTheDocument();
  expect(assign).not.toHaveBeenCalled();
  await f.disable();
  expect(
    screen.getByRole("button", { name: "Workspace: Work" }),
  ).toBeInTheDocument();
});

it("retains unread workers while compact cards show bounded reactive message previews and expanded disclosure carries unread", async () => {
  const user = userEvent.setup();
  const f = await enhancedFixture([parent, child], 10);
  f.channelUnread(id, 0);
  f.channelUnread(other, 1);
  await act(async () => {
    await f.navigator.open(soloDraftTarget(scope));
  });
  const root = () => screen.getByRole("button", { name: /^Planning/ });
  f.channelPreview(
    id,
    "**Latest** [reply](https://example.test/private)\nReady to review.",
  );
  expect(root()).toHaveTextContent("Latest reply Ready to review.");
  expect(root()).toHaveTextContent("Build sidebar"); // Generic provider subtitles stay supported.
  expect(root()).not.toHaveTextContent("1 unread");
  expect(root()).not.toHaveTextContent("task/sidebar");
  f.channelPreview(id, "Edited **reply**");
  expect(root()).toHaveTextContent("Edited reply");
  expect(root()).not.toHaveTextContent("Latest reply");
  f.channelPreview(id, undefined);
  expect(
    root().querySelector("[data-solo-message-preview]"),
  ).not.toBeInTheDocument();
  f.channelPreview(id, "<!-- invisible -->");
  expect(
    root().querySelector("[data-solo-message-preview]"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /workers?:/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^Other/ }),
  ).not.toBeInTheDocument();
  f.channelPreview(id, "A current reply");
  await user.click(root());
  expect(root()).toHaveTextContent("A current reply");
  expect(root()).toHaveTextContent("task/sidebar");
  await user.click(screen.getByRole("button", { name: /1 worker:/i }));
  const worker = screen.getByRole("button", { name: /^Other/ });
  expect(worker.querySelector("[data-solo-message-preview]")).toBeNull();
  expect(
    worker.querySelector('[role="img"][aria-label="Waiting"]'),
  ).not.toBeNull();
  expect(worker).not.toHaveTextContent("Waiting");
  await user.click(worker);
  expect(root()).toHaveTextContent("A current reply");
  expect(root()).toHaveTextContent("task/sidebar");
  expect(worker).toHaveTextContent("Waiting");
  const disclosure = screen.getByRole("button", {
    name: /1 worker: 1 waiting, 1 unread/i,
  });
  expect(disclosure).toHaveTextContent("1 waiting, 1 unread");
  expect(disclosure).not.toHaveTextContent(/worker/i);
  await user.click(disclosure);
  expect(disclosure).toHaveTextContent("1 unread");
  f.update([
    parent,
    child,
    {
      channelId: "newer-0",
      status: "done",
      details: [{ label: "Repository", value: "other/repo" }],
    },
  ]);
  const unrelatedRoot = screen.getByRole("button", { name: /^Newer 0/ });
  expect(unrelatedRoot).not.toHaveTextContent("other/repo");
  await user.click(unrelatedRoot);
  await waitFor(() =>
    expect(unrelatedRoot).toHaveAttribute("aria-current", "page"),
  );
  expect(unrelatedRoot).toHaveTextContent("other/repo");
  expect(root()).not.toHaveTextContent("task/sidebar");
  expect(root()).toHaveTextContent("A current reply");
});

it("keeps a 0-of-1 disclosure target in the DOM and reveals the current path on direct owner replacement", async () => {
  const user = userEvent.setup();
  const f = await enhancedFixture([parent, child]);
  await user.click(screen.getByRole("button", { name: /1 worker:/i }));
  expect(screen.getByRole("button", { name: /1 worker:/i })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await f.replace();
  expect(screen.getByRole("button", { name: /1 worker:/i })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await act(async () => {
    await f.navigator.open(conversationTarget(scope, id));
  });
  await user.click(screen.getByRole("button", { name: /1 worker:/i }));
  f.update([parent, { ...child, status: "archived" }]);
  act(() =>
    f.service?.setOptions({
      group: "status",
      sort: "recent",
      show: "active-tasks",
    }),
  );
  const workers = screen.getByRole("button", { name: /0 of 1 shown/ });
  const target = workers.getAttribute("aria-controls");
  expect(target && document.getElementById(target)).toBeInTheDocument();
  expect(workers).toHaveAttribute("aria-expanded", "false");
});

it.each(["none", "status"] as const)(
  "moves a non-current root from %s into a saved collapsed workspace and restores dormant child assignments on disable",
  async (group) => {
    writeView(scope, "solo:collapsed-projects", ["destination"]);
    const user = userEvent.setup();
    const f = await enhancedFixture([parent, child]);
    let preferences = {
      status: "ready" as const,
      data: {
        sections: [
          { id: "work", name: "Work", order: 0 },
          { id: "child-work", name: "Child work", order: 1 },
          { id: "destination", name: "Destination", order: 2 },
        ],
        assignments: { [id]: "work", [other]: "child-work" },
        starred: [],
        muted: [],
      },
    };
    const listeners = new Set<() => void>();
    const assign = vi.fn(async (channelId: string, projectId?: string) => {
      preferences = {
        ...preferences,
        data: {
          ...preferences.data,
          assignments: {
            ...preferences.data.assignments,
            [channelId]: projectId ?? "",
          },
        },
      };
      for (const listener of listeners) listener();
    });
    act(() =>
      Object.assign(f.session.soloPreferences, {
        writable: true,
        snapshot: () => preferences,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        assign,
      }),
    );
    f.update([parent, child]);
    const placement = () =>
      screen
        .getByRole("button", { name: /^Other/ })
        .closest("[data-solo-project]")
        ?.getAttribute("data-solo-project");
    expect(placement()).toBe("work");
    act(() =>
      f.service?.setOptions({
        group: "status",
        sort: "name",
        show: "all-chats",
      }),
    );
    expect(placement()).toBe("@status:running");
    act(() =>
      f.service?.setOptions({ group: "none", sort: "name", show: "all-chats" }),
    );
    expect(placement()).toBe("@none");
    act(() =>
      f.service?.setOptions({ group, sort: "name", show: "all-chats" }),
    );
    await act(async () => {
      await f.navigator.open(soloDraftTarget(scope));
    });
    await user.click(
      screen.getByRole("button", { name: "Actions for Planning" }),
    );
    const move = await screen.findByRole("menuitem", { name: "Move to" });
    move.focus();
    await user.keyboard("{ArrowRight}");
    const destination = await screen.findByRole("menuitem", {
      name: "Destination",
    });
    destination.focus();
    await user.keyboard("{Enter}");
    expect(assign).toHaveBeenCalledExactlyOnceWith(id, "destination");
    expect(f.service?.snapshot()?.options.group).toBe("workspace");
    expect(screen.getByRole("button", { name: /^Planning/ })).toBeVisible();
    expect(readView(scope, "solo:collapsed-projects", [])).toEqual([]);
    await act(async () => {
      await f.navigator.open(conversationTarget(scope, other));
    });
    expect(placement()).toBe("destination");
    await f.disable();
    expect(placement()).toBe("child-work");
  },
);

it("reveals a new chat draft in the collapsed Status Chats group", async () => {
  const user = userEvent.setup();
  const f = await enhancedFixture([parent]);
  act(() =>
    f.service?.setOptions({
      group: "status",
      sort: "recent",
      show: "all-chats",
    }),
  );
  await user.click(screen.getByRole("button", { name: /^Chats$/ }));
  expect(
    screen.queryByRole("button", { name: /^Other/ }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await f.navigator.open(soloDraftTarget(scope));
  });
  expect(screen.getByRole("button", { name: /^New chat$/ })).toBeVisible();
});

it("keeps row focus when a status update remounts the task in another group", async () => {
  const f = await enhancedFixture([parent]);
  act(() =>
    f.service?.setOptions({
      group: "status",
      sort: "recent",
      show: "all-chats",
    }),
  );
  const before = screen.getByRole("button", { name: /^Planning/ });
  before.focus();
  f.update([{ ...parent, status: "done" }]);
  expect(screen.getByRole("button", { name: /^Planning/ })).toHaveFocus();
  expect(before.isConnected).toBe(false);
  const outside = screen.getByRole("button", { name: "Inbox" });
  outside.focus();
  f.update([parent]);
  expect(outside).toHaveFocus();
});

it("restores meaningful row focus when the workspace trigger becomes a follows note", async () => {
  const f = await enhancedFixture([
    parent,
    { channelId: other, status: "waiting" },
  ]);
  render(<WorkspaceControl session={f.session} channelId={other} />);
  const trigger = screen.getByRole("button", { name: "Add workspace" });
  trigger.focus();
  f.update([parent, child]);
  expect(screen.getByText("Workspace follows Planning")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Planning/ })).toHaveFocus();
});

it.each(["regroup", "filter"] as const)(
  "restores focus from an open row popup after metadata %s",
  async (change) => {
    const user = userEvent.setup();
    const f = await enhancedFixture([parent, child]);
    if (change === "filter") {
      await act(async () => {
        await f.navigator.open(conversationTarget(scope, id));
      });
      expect(
        screen.getByRole("button", { name: /1 worker:/i }),
      ).toHaveAttribute("aria-expanded", "true");
      act(() =>
        f.service?.setOptions({
          group: "workspace",
          sort: "recent",
          show: "active-tasks",
        }),
      );
    } else {
      act(() =>
        f.service?.setOptions({
          group: "status",
          sort: "recent",
          show: "all-chats",
        }),
      );
    }
    await user.click(
      screen.getByRole("button", {
        name:
          change === "filter" ? "Actions for Other" : "Actions for Planning",
      }),
    );
    const copy = await screen.findByRole("menuitem", { name: /^Copy$/ });
    copy.focus();
    if (change === "regroup") {
      await user.keyboard("{ArrowRight}");
      (await screen.findByRole("menuitem", { name: "Copy chat name" })).focus();
      f.update([{ ...parent, status: "done" }, child]);
    } else {
      f.update([parent, { ...child, status: "archived" }]);
    }
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Planning/ })).toHaveFocus();
  },
);

it("renders saved worker identity and refreshed status summaries", async () => {
  const f = await enhancedFixture([parent, child]);
  const picture =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3sAAAAASUVORK5CYII=";
  const profiles = new Map(f.session.profiles.snapshot());
  profiles.set(outsider, { name: "Assigned reviewer", picture, isAgent: true });
  act(() =>
    Object.assign(f.session.profiles, {
      snapshot: () => profiles,
      ensure: async () => {},
    }),
  );
  f.update([parent, { ...child, primaryAgent: outsider, status: "done" }]);
  expect(
    screen.getByRole("button", { name: /1 worker:.*1 done/i }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /1 worker:.*1 running/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /1 worker:.*1 waiting/i }),
  ).not.toBeInTheDocument();
  const row = () => screen.getByRole("button", { name: /^Other/ });
  expect(row().querySelector("img")).toHaveAttribute("src", picture);
  expect(
    row().querySelector('[title="Assigned reviewer"]'),
  ).toBeInTheDocument();
  f.update([parent, { ...child, primaryAgent: agent }]);
  expect(
    screen.getByRole("button", { name: /1 worker:.*1 waiting/i }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /1 worker:.*1 done/i }),
  ).not.toBeInTheDocument();
  expect(row().querySelector("img")).not.toBeInTheDocument();
  expect(row().querySelector('[title="Owned Agent"]')).toBeInTheDocument();
  f.update([parent, child]);
  expect(
    row().querySelector('[title="No primary agent assigned"]'),
  ).toBeInTheDocument();
});

it("distinguishes every root task status by shape without relying on color", async () => {
  const statuses = [
    "running",
    "waiting",
    "done",
    "failed",
    "archived",
  ] as const;
  await enhancedFixture(
    statuses.map((status, index) => ({
      channelId: index === 0 ? id : index === 1 ? other : `newer-${index - 2}`,
      status,
    })),
    3,
  );
  const shapes = ["Running", "Waiting", "Done", "Failed", "Archived"].map(
    (label) => {
      const mark = screen.getByRole("img", { name: label });
      const glyph = mark.querySelector("svg");
      expect(glyph).not.toBeNull();
      return glyph?.innerHTML;
    },
  );
  expect(new Set(shapes).size).toBe(5);
});
