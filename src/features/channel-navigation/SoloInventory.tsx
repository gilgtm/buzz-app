import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type RefObject,
} from "react";
import { useChannelNavigation } from "./ChannelNavigationState";
import { ownSolo } from "../solo/labels";
import { conversationTarget, soloDraft, soloDraftTarget } from "./routes";
import { ChannelActivityPopover } from "../../bundled/channels/ChannelActivityPopover";
import { useWorkingAgents } from "../../bundled/channels/useWorkingAgents";
import { WorkingAgentsBadge } from "../../bundled/channels/WorkingAgentsBadge";
import { UnreadBadge } from "../../bundled/channels/UnreadBadge";
import { useUnreadChannelIds } from "../../bundled/channels/useSidebarFilters";
import { SoloWorkspaces } from "../../bundled/channels/SoloWorkspaces";
import {
  soloSharedMarkId,
  useSharedWithPeople,
} from "../../bundled/channels/ChatSharedMark";
import { useChannelList } from "../relay/react";
import type { RelaySession } from "../relay/session";
import type { ChannelSummary } from "../relay/contracts";
import { useRecoveryShown } from "../relay/RecoveryNotice";
import type { Navigation } from "../navigation/controller";
import type { OpenTarget } from "../navigation/targets";
import { buzzLinkTarget } from "../navigation/buzz-links";
import { resetNewChatProject } from "../solo/SoloDraft";
import { NewWorkspace } from "../solo/NewWorkspace";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuNote,
} from "../../shared/design-system/ui/Menu";
import { plainText } from "../notifications/content";
import { SoloTaskAvatar } from "./SoloTaskAvatar";
import { useSoloNavigation } from "./solo-navigation-react";
import { soloNavigationFor } from "./solo-navigation";
import {
  SOLO_VIEW_DEFAULTS,
  SOLO_STATUS_LABELS,
} from "./solo-navigation-model";
import type { SoloTaskRow } from "./solo-navigation-contract";
import creationStyles from "./SoloInventory.module.css";
import {
  PlusIcon,
  ChatCircleIcon,
  SlidersHorizontalIcon,
  CircleNotchIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArchiveIcon,
} from "../../shared/design-system/icons";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import type { ContributionReader } from "../conversation/contracts";
import type { ChatIcon } from "../conversation/service";
import channelStyles from "../../bundled/channels/Channels.module.css";
import styles from "../../bundled/channels/SoloWorkspaces.module.css";

const taskStatusIcons = {
  running: CircleNotchIcon,
  waiting: ClockIcon,
  done: CheckCircleIcon,
  failed: XCircleIcon,
  archived: ArchiveIcon,
};

const noSubscription = () => () => {};
const chatIcon = (
  <span className={styles.conversationIcon} aria-hidden="true">
    <ChatCircleIcon size={16} />
  </span>
);

/** Solo projects and conversations: the owner's private filing of ordinary channels. */
export function SoloInventory({
  session,
  scope,
  navigator,
  target,
  chatIcons,
}: {
  session: RelaySession;
  scope: string;
  navigator: Navigation;
  target: OpenTarget;
  /** Plugin icons that can stand in for a chat's own. */
  chatIcons?: ContributionReader<ChatIcon> | undefined;
}) {
  const list = useChannelList(session.channels);
  const enhanced = useSoloNavigation(session);
  const title = enhanced?.enhancement.title ?? "Solo";
  const assignedAgents = [
    ...new Set(
      [...(enhanced?.forest.tasks.values() ?? [])].flatMap((task) =>
        task.primaryAgent ? [task.primaryAgent] : [],
      ),
    ),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    if (assignedAgents)
      void session.profiles.ensure(assignedAgents.split(",")).catch(() => {});
  }, [session.profiles, assignedAgents]);
  const pendingClick = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const preferences = useSyncExternalStore(
    session.soloPreferences.subscribe,
    session.soloPreferences.snapshot,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [excluded, setExcluded] = useState(0);
  const [creatingProject, setCreatingProject] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const recoveryShown = useRecoveryShown(session.recovery);
  const selected =
    target.kind === "conversation" ? target.channelId : undefined;
  const draft =
    target.kind === "page" &&
    target.pluginId === "buzz.channels" &&
    target.pageId === "channels"
      ? soloDraft(target.route?.params)
      : undefined;
  const handoff = useChannelNavigation();
  const workingIds = useSyncExternalStore(
    session.agentActivity.subscribeWorking,
    session.agentActivity.workingSnapshot,
    session.agentActivity.workingSnapshot,
  );
  const ChatIcon = useSyncExternalStore(
    chatIcons?.subscribe ?? noSubscription,
    () => chatIcons?.snapshot()[0]?.component,
  );
  const workingChannels = new Set<string>(JSON.parse(workingIds));
  const open = (channelId: string) =>
    navigator.open(conversationTarget(scope, channelId));
  const openMessage = (channelId: string, messageId?: string) => {
    if (handoff && handoff.session !== session) return;
    const destination =
      messageId && session.viewer
        ? buzzLinkTarget(
            `buzz://message?channel=${channelId}&id=${messageId}`,
            {
              viewer: session.viewer,
              communityOrigin: scope.slice(0, -(session.viewer.length + 1)),
            },
          )
        : conversationTarget(scope, channelId);
    if (destination) void navigator.open(destination);
  };
  const openAgentActivity = (channelId: string, agent: string) => {
    if (!handoff || handoff.session !== session) return;
    const intent = {
      channelId,
      agent,
      trigger: document.querySelector<HTMLElement>(
        `[data-solo-channel-id="${CSS.escape(channelId)}"]`,
      ),
    };
    handoff.activityAgent.current = intent;
    void open(channelId).then(() => {
      if (handoff.activityAgent.current === intent)
        handoff.activityAgent.current = undefined;
    });
  };
  const conversations = list.channels
    // Solo chats the viewer belongs to: their own and those shared with them.
    // Opening one from a link without membership adds nothing here.
    .filter(
      (item) =>
        !item.archived &&
        item.channelType === "solo" &&
        (!item.readOnly || ownSolo(item, session.viewer)),
    )
    .sort(
      (a, b) =>
        (b.lastActivityAt ?? b.updatedAt ?? 0) -
          (a.lastActivityAt ?? a.updatedAt ?? 0) || a.id.localeCompare(b.id),
    );
  // Capped workspaces never hide the open chat or one that needs the viewer.
  const unreadChats = useUnreadChannelIds(
    session.unread,
    JSON.stringify(conversations.map((item) => item.id)),
  );
  const empty =
    list.status === "ready" &&
    preferences.status === "ready" &&
    !conversations.length &&
    !preferences.data?.sections.length;
  const current = () => !handoff || handoff.session === session;
  const newChat = (project?: string) => {
    if (!current()) return;
    if (project) resetNewChatProject(scope, project);
    void navigator.open(soloDraftTarget(scope, project ? { project } : {}));
  };
  return (
    <nav
      className={styles.sidebarContents}
      aria-label={`${title} conversations`}
    >
      <div
        className={creationStyles.header}
        data-actions-visible={
          menuOpen || viewMenuOpen || !!enhanced || undefined
        }
      >
        <InlineHeader
          title={<span className="text-standard">{title}</span>}
          actions={
            <div className={creationStyles.actions}>
              {enhanced && (
                <MenuRoot open={viewMenuOpen} onOpenChange={setViewMenuOpen}>
                  <MenuTrigger
                    render={
                      <IconButton
                        size="compact"
                        data-solo-collection-control=""
                        aria-label="Group and sort"
                        title="Group and sort"
                        icon={<SlidersHorizontalIcon size={15} />}
                      />
                    }
                  />
                  <MenuPopup align="end" aria-label="Group and sort">
                    {(
                      [
                        [
                          "group",
                          "Group by",
                          [
                            ["workspace", "Workspace"],
                            ["status", "Status"],
                            ["none", "None"],
                          ],
                        ],
                        [
                          "sort",
                          "Sort by",
                          [
                            ["recent", "Recent activity"],
                            ["name", "Name"],
                          ],
                        ],
                        [
                          "show",
                          "Show",
                          [
                            ["all-chats", "All chats"],
                            ["active-tasks", "Active tasks"],
                            ["all-tasks", "All tasks"],
                          ],
                        ],
                      ] as const
                    ).map(([key, label, choices]) => (
                      <MenuGroup key={key}>
                        <MenuGroupLabel>{label}</MenuGroupLabel>
                        <MenuRadioGroup
                          value={enhanced.options[key]}
                          onValueChange={(value) =>
                            soloNavigationFor(session)?.setOptions({
                              ...enhanced.options,
                              [key]: value,
                            })
                          }
                        >
                          {choices.map(([value, name]) => (
                            <MenuRadioItem key={value} value={value}>
                              {name}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuGroup>
                    ))}
                    <MenuSeparator />
                    <MenuNote>{excluded} chats hidden by filter</MenuNote>
                    <MenuItem
                      onClick={() =>
                        soloNavigationFor(session)?.setOptions({
                          ...enhanced.options,
                          show: "all-chats",
                        })
                      }
                    >
                      Show all chats
                    </MenuItem>
                    <MenuItem
                      onClick={() =>
                        soloNavigationFor(session)?.setOptions(
                          SOLO_VIEW_DEFAULTS,
                        )
                      }
                    >
                      Reset view
                    </MenuItem>
                  </MenuPopup>
                </MenuRoot>
              )}

              <MenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
                <MenuTrigger
                  render={
                    <IconButton
                      ref={trigger}
                      size="compact"
                      aria-label="New chat or workspace"
                      title="New chat or workspace"
                      icon={<PlusIcon size={15} strokeWidth={2.5} />}
                    />
                  }
                />
                <MenuPopup align="end">
                  <MenuItem onClick={() => newChat()}>New chat</MenuItem>
                  {enhanced?.enhancement.create && (
                    <MenuItem
                      onClick={() => void soloNavigationFor(session)?.create()}
                    >
                      {enhanced.enhancement.create.label}
                    </MenuItem>
                  )}
                  <MenuItem
                    disabled={!session.soloPreferences.sectionCreationWritable}
                    onClick={() => {
                      if (current()) {
                        if (enhanced)
                          soloNavigationFor(session)?.setOptions({
                            ...enhanced.options,
                            group: "workspace",
                          });
                        setCreatingProject(true);
                      }
                    }}
                  >
                    New workspace…
                  </MenuItem>
                </MenuPopup>
              </MenuRoot>
            </div>
          }
        />
      </div>
      {enhanced?.notice && (
        <p role="status" className={styles.listMessage}>
          {enhanced.notice}
        </p>
      )}
      {empty && (
        <NavigationItem
          variant="row"
          label="New chat"
          icon={<PlusIcon size={16} />}
          onClick={() => newChat()}
        />
      )}
      {creatingProject && (
        <NewWorkspace
          session={session}
          create={(section) => session.soloPreferences.createSection(section)}
          close={() => setCreatingProject(false)}
          finalFocus={trigger}
          onCreated={(id) => {
            if (trigger.current?.isConnected) newChat(id);
          }}
        />
      )}
      <SoloWorkspaces
        navigator={navigator}
        enhanced={enhanced}
        currentId={selected}
        activity={{ unread: unreadChats, working: workingChannels }}
        onFilteredCount={setExcluded}
        draft={
          draft
            ? {
                projectId: draft.project,
                content: (
                  <NavigationItem
                    label="New chat"
                    selected
                    icon={
                      <span
                        className={styles.conversationIcon}
                        aria-hidden="true"
                      >
                        <ChatCircleIcon size={16} />
                      </span>
                    }
                    onClick={() => void navigator.open(target)}
                  />
                ),
              }
            : undefined
        }
        visit={navigator.snapshot().attempt.signal}
        session={session}
        scope={scope}
        onConverted={(channelId) => {
          if (handoff && handoff.session !== session) return;
          void open(channelId).then((result) => {
            if (result.status !== "opened") return;
            document
              .querySelector<HTMLElement>(
                `[data-channel-workspace="${CSS.escape(channelId)}"] form [role="textbox"]`,
              )
              ?.focus({ preventScroll: true });
          });
        }}
        chats={conversations.map((item) => ({
          id: item.id,
          title: item.name,
          pinned:
            selected === item.id ||
            workingChannels.has(item.id) ||
            unreadChats.has(item.id),
        }))}
        onNew={newChat}
        renderChat={(item, rename, annotation) => (
          <SoloConversationRow
            key={item.id}
            session={session}
            navigation={navigator}
            pendingClick={pendingClick}
            id={item.id}
            channel={conversations.find(
              (conversation) => conversation.id === item.id,
            )}
            title={item.title}
            task={enhanced?.forest.tasks.get(item.id)}
            nested={enhanced?.forest.parents.has(item.id)}
            annotation={annotation}
            selected={selected === item.id}
            working={workingChannels.has(item.id)}
            Icon={ChatIcon}
            onSelect={() => void open(item.id)}
            onRename={rename}
            onOpenThread={(thread) =>
              openMessage(thread.channelId, thread.rootId)
            }
            onOpenWorkingAgent={(id, _agent, messageId) => {
              if (messageId) openMessage(id, messageId);
              else void open(id);
            }}
            onOpenAgentActivity={openAgentActivity}
          />
        )}
      />
      {list.status === "loading" && <p role="status">Loading conversations…</p>}
      {list.status === "error" && !recoveryShown && (
        <p role="alert">{list.error}</p>
      )}
    </nav>
  );
}

function SoloConversationRow({
  session,
  navigation,
  pendingClick,
  id,
  channel,
  title,
  selected,
  working,
  task,
  nested = false,
  annotation,
  Icon,
  onSelect,
  onRename,
  onOpenThread,
  onOpenWorkingAgent,
  onOpenAgentActivity,
}: {
  session: RelaySession;
  navigation: Navigation;
  pendingClick: RefObject<ReturnType<typeof setTimeout> | undefined>;
  id: string;
  channel: ChannelSummary | undefined;
  title: string;
  selected: boolean;
  working: boolean;
  task?: SoloTaskRow | undefined;
  nested?: boolean | undefined;
  annotation?: string | undefined;
  Icon?: ChatIcon["component"] | undefined;
  onSelect: () => void;
  onRename: (() => boolean) | undefined;
} & Pick<
  ComponentProps<typeof ChannelActivityPopover>,
  "onOpenThread" | "onOpenWorkingAgent" | "onOpenAgentActivity"
>) {
  const click = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<string | undefined>(undefined);
  useEffect(() => () => clearTimeout(click.current), []);
  const { agents, agentProfiles, waiting } = useWorkingAgents(
    session,
    id,
    working,
  );
  // Describe only by a mark that renders, using the same Shared evidence.
  const shared = useSharedWithPeople(session, channel);
  const expandedContent = !nested || selected;
  const compactWorker = !!task && !expandedContent;
  const preview =
    task && expandedContent && channel?.preview
      ? plainText(channel.preview)
      : undefined;
  const StatusIcon = taskStatusIcons[task?.status ?? "archived"];
  return (
    <ChannelActivityPopover
      session={session}
      channelId={id}
      channelName={title}
      agents={agents}
      agentProfiles={agentProfiles}
      onOpenThread={onOpenThread}
      {...(onOpenWorkingAgent ? { onOpenWorkingAgent } : {})}
      {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
      trigger={
        <NavigationItem
          type="button"
          multiline={!!task || !!annotation}
          selected={selected}
          data-solo-channel-id={id}
          aria-current={selected ? "page" : undefined}
          aria-describedby={shared ? soloSharedMarkId(id) : undefined}
          aria-description={compactWorker ? annotation : undefined}
          onPointerDown={(event) => {
            pointer.current = event.pointerType;
          }}
          onClick={(event) => {
            if (event.detail >= 2) return;
            clearTimeout(pendingClick.current);
            const touch = pointer.current === "touch";
            pointer.current = undefined;
            if (
              event.detail === 1 &&
              onRename &&
              !touch &&
              window.matchMedia("(max-width: 650px)").matches
            ) {
              // Keep the drawer present for a mouse double-click. Touch and
              // keyboard activation, and wide layouts, navigate immediately.
              const attempt = navigation.snapshot().attempt;
              click.current = pendingClick.current = setTimeout(() => {
                if (navigation.snapshot().attempt.id === attempt.id) onSelect();
              }, 500);
            } else onSelect();
          }}
          onDoubleClick={
            onRename
              ? () => {
                  clearTimeout(pendingClick.current);
                  if (!onRename()) onSelect();
                }
              : undefined
          }
          onContextMenu={() => clearTimeout(pendingClick.current)}
          icon={
            task ? (
              nested ? (
                <SoloTaskAvatar session={session} agent={task.primaryAgent} />
              ) : null
            ) : Icon ? (
              <Icon session={session} channelId={id} fallback={chatIcon} />
            ) : (
              chatIcon
            )
          }
          label={
            <span
              className={task || annotation ? styles.taskLabel : styles.chatRow}
            >
              {task ? (
                <span
                  className={styles.taskHeading}
                  data-worker={nested || undefined}
                  data-compact={compactWorker || undefined}
                >
                  <span className={`${styles.taskTitle} text-label-sm`}>
                    <UnreadBadge
                      session={session}
                      channelId={id}
                      label={title}
                      labelUnread="all"
                    />
                  </span>
                  <span
                    className={`${styles.taskStatus} text-caption`}
                    data-status={task.status}
                    role="img"
                    aria-label={SOLO_STATUS_LABELS[task.status]}
                    title={SOLO_STATUS_LABELS[task.status]}
                  >
                    <StatusIcon size={14} />
                    {nested &&
                      !compactWorker &&
                      SOLO_STATUS_LABELS[task.status]}
                  </span>
                </span>
              ) : (
                <UnreadBadge
                  session={session}
                  channelId={id}
                  label={title}
                  labelUnread="all"
                />
              )}
              {task?.subtitle && expandedContent && (
                <span className="text-caption text-subtle">
                  {task.subtitle}
                </span>
              )}
              {preview && (
                <span
                  className="text-caption text-subtle"
                  data-solo-message-preview=""
                >
                  {preview}
                </span>
              )}
              {annotation && !compactWorker && (
                <span className="text-caption text-subtle">{annotation}</span>
              )}
              {task &&
                expandedContent &&
                task.details?.map((detail) => (
                  <span key={detail.label} className={styles.taskDetail}>
                    <span className="text-caption text-metadata">
                      {detail.label}
                    </span>
                    <span className="font-mono text-mono text-subtle">
                      {detail.value}
                    </span>
                  </span>
                ))}
            </span>
          }
          trailing={
            <span
              className={channelStyles.indicatorStack}
              data-solo-working-indicator=""
            >
              <WorkingAgentsBadge
                agents={agents}
                profiles={agentProfiles}
                channelName={title}
                waiting={waiting}
              />
            </span>
          }
        />
      }
    />
  );
}
