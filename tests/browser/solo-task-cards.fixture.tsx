import "../../src/shared/styles/globals.css";
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
import { ToastProvider } from "../../src/shared/design-system/ui/Toast";

const parent = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const viewer = "a".repeat(64);
const scope = `https://relay.test:${viewer}`;
const base = createRelaySession(null).session;
const list = {
  status: "ready" as const,
  channels: [
    {
      id: parent,
      name: "Planning",
      channelType: "solo" as const,
      creator: viewer,
    },
    {
      id: child,
      name: "Review",
      channelType: "solo" as const,
      creator: viewer,
    },
  ],
};
const preferences = {
  status: "ready" as const,
  data: { sections: [], assignments: {}, starred: [], muted: [] },
};
const session: RelaySession = {
  ...base,
  scope,
  viewer,
  channels: { ...base.channels, list: () => list, ensureList() {} },
  soloPreferences: {
    ...base.soloPreferences,
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
            subtitle: "Build task sidebar",
            details: [{ label: "Branch", value: "task/sidebar" }],
          },
          {
            channelId: child,
            parentChannelId: parent,
            status: "waiting",
            subtitle: "Check workspace moves",
          },
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
