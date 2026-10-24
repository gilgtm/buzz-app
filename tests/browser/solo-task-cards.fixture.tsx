import "../../src/shared/styles/globals.css";
import workerAvatar from "../fixtures/design-system/assets/avatar.png";
import { Context } from "@deepseek-ai/cordis";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PrimarySidebar } from "../../src/app/shell/PrimarySidebar";
import { ChannelNavigationProvider } from "../../src/features/channel-navigation/ChannelNavigationState";
import { conversationTarget } from "../../src/features/channel-navigation/routes";
import { SoloNavigationService } from "../../src/features/channel-navigation/solo-navigation";
import {
  createRelaySession,
  type RelaySession,
} from "../../src/features/relay/session";
import type { RelayData } from "../../src/features/relay/service";
import type { Navigation } from "../../src/features/navigation/controller";
import type { OpenTarget } from "../../src/features/navigation/targets";
import { writeView } from "../../src/shared/view-state";
import { ToastProvider } from "../../src/shared/design-system/ui/Toast";

const parent = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const params = new URLSearchParams(location.search);
const workers = [
  {
    id: child,
    name: "Review workspace moves",
    status: "waiting" as const,
    agent: "b".repeat(64),
    agentName: "Review Agent",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Implement task model",
    status: "done" as const,
    agent: "c".repeat(64),
    agentName: "Build Agent",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Verify focus recovery",
    status: "running" as const,
    agent: "d".repeat(64),
    agentName: "Test Agent",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Check relay contract",
    status: "failed" as const,
    agent: "e".repeat(64),
    agentName: "Relay Agent",
  },
];
const profiles = new Map(
  workers.map((worker, index) => [
    worker.agent,
    {
      name: worker.agentName,
      ...(index === 0 ? { picture: "https://images.test/assigned.png" } : {}),
      isAgent: true as const,
    },
  ]),
);
const statusRoots = params.has("status-roots");
const viewer = "a".repeat(64);
const scope = `https://relay.test:${viewer}`;
if (params.has("width"))
  writeView(scope, "channel-sidebar", { width: Number(params.get("width")) });
if (params.has("theme"))
  document.documentElement.dataset.colorMode = params.get("theme") ?? "dark";
const base = createRelaySession(null).session;
const list = {
  status: "ready" as const,
  channels: [
    {
      id: parent,
      name: params.has("visual")
        ? "Modernize checkout"
        : "Planning a long task title that must stay clear of the row actions",
      channelType: "solo" as const,
      preview:
        "Please make the task sidebar easier to scan, while keeping every worker action available.",
      creator: viewer,
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Notes",
      channelType: "solo" as const,
      creator: viewer,
    },
    ...workers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      preview: "The workspace move and focus recovery checks pass.",
      channelType: "solo" as const,
      creator: viewer,
    })),
  ],
};
const preferences = {
  status: "ready" as const,
  data: { sections: [], assignments: {}, starred: [], muted: [] },
};
const unreadSnapshots = new Map(
  list.channels.map((channel) => [
    channel.id,
    {
      ...base.unread.snapshot({ kind: "channel", channelId: channel.id }),
      observedCount: channel.id === child ? 1 : 0,
    },
  ]),
);
const session: RelaySession = {
  ...base,
  scope,
  viewer,
  media: () => workerAvatar,
  unread: {
    ...base.unread,
    snapshot: (target) =>
      target.kind === "channel"
        ? (unreadSnapshots.get(target.channelId) ??
          base.unread.snapshot(target))
        : base.unread.snapshot(target),
  },
  profiles: {
    ...base.profiles,
    snapshot: () => profiles,
    ensure: async () => {},
  },
  channels: { ...base.channels, list: () => list, ensureList() {} },
  soloPreferences: {
    ...base.soloPreferences,
    writable: true,
    snapshot: () => preferences,
    ensure: async () => {},
  },
};
const snapshot = {
  status: "ready" as const,
  session,
  generation: 1,
  scope,
  viewer,
};
const relay: RelayData = {
  snapshot: () => snapshot,
  subscribe: () => () => {},
  retry() {},
  disconnect() {},
  async clearCache() {},
};
const ctx = new Context();
ctx.provide("pluginStatus", {
  isActive: () => true,
  subscribe: () => () => {},
});
const soloNavigation = new SoloNavigationService(ctx, relay);
await ctx
  .extend({ pluginOwner: { id: "cards.fixture", revision: "one" } })
  .plugin((ctx) =>
    ctx.soloNavigation.register({
      id: "tasks",
      title: "Nexus",
      childNoun: { one: "Worker", other: "Workers" },
      dataRevision: () => 1,
      subscribe: () => () => {},
      read: () => ({
        rows: [
          {
            channelId: parent,
            status: "running",
            details: [{ label: "Branch", value: "task/sidebar" }],
          },
          ...workers.map((worker) => ({
            channelId: worker.id,
            ...(statusRoots ? {} : { parentChannelId: parent }),
            primaryAgent: worker.agent,
            status:
              statusRoots && worker.status === "running"
                ? ("archived" as const)
                : worker.status,
          })),
        ],
      }),
    }),
  )
  .await();

function Fixture() {
  const [target, setTarget] = useState<OpenTarget>(
    conversationTarget(scope, child),
  );
  const navigator = {
    open: async (next: OpenTarget) => {
      setTarget(next);
      return { status: "opened" as const };
    },
    subscribe: () => () => {},
    snapshot: () => ({
      entry: { target },
      status: "opened",
      attempt: { id: "fixture", signal: new AbortController().signal },
    }),
  } as unknown as Navigation;
  return (
    <ToastProvider>
      <ChannelNavigationProvider relay={relay}>
        <PrimarySidebar
          relay={relay}
          navigator={navigator}
          target={target}
          soloNavigation={soloNavigation}
        >
          <button type="button">Inbox</button>
        </PrimarySidebar>
      </ChannelNavigationProvider>
    </ToastProvider>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
