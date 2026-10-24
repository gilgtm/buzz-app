import { useChatConversions } from "../../features/solo/conversion";
import { ConvertToChannel } from "../../features/solo/ConvertToChannel";
import { ChatSharedMark } from "./ChatSharedMark";
import { requestSidebarPlacementReveal } from "./useSidebarView";
import { ChannelMembersDialog } from "./ChannelMembersDialog";
import { SoloChatName } from "./SoloChatName";
import { canEditLifetime } from "../../features/solo/Lifetime";
import { useChannelNavigation } from "../../features/channel-navigation/ChannelNavigationState";
import { soloDraftTarget } from "../../features/channel-navigation/routes";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { ChannelLifecycleAction } from "../../features/relay/channel-lifecycle-protocol";
import { Collapsible } from "@base-ui/react/collapsible";
import { useDroppable } from "@dnd-kit/core";
import {
  ChannelSidebarDnd,
  DraggableChannel,
} from "../../features/channel-navigation/ChannelSidebarDnd";
import { WorkspaceSettings } from "../../features/solo/WorkspaceSettings";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { RelaySession } from "../../features/relay/session";
import { readView, writeView } from "../../shared/view-state";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
} from "../../shared/design-system/ui/Menu";
import {
  CaretDownIcon,
  DotsThreeIcon,
  PlusIcon,
} from "../../shared/design-system/icons";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import type { Navigation } from "../../features/navigation/controller";
import {
  NewWorkspaceDialog,
  SoloChatMenuItems,
  useChatCopy,
} from "./SoloChatMenu";
import {
  projectSolo,
  soloAncestors,
  SOLO_STATUS_LABELS,
} from "../../features/channel-navigation/solo-navigation-model";
import { prepareSoloMove } from "../../features/channel-navigation/solo-navigation";
import type { SoloNavigationSnapshot } from "../../features/channel-navigation/solo-navigation";
import { NavigationCard } from "../../shared/design-system/ui/NavigationItem";
import styles from "./SoloWorkspaces.module.css";
import channelStyles from "./Channels.module.css";

/** Presentation only. The caller supplies authorized, saved chats. */
export type ChatListItem = Readonly<{
  id: string;
  title: string;
  /** Stays listed past a workspace's cap, like the open or an unread chat. */
  pinned?: boolean;
}>;

/** Each workspace lists its most recent chats; Show more adds a step. */
export const SOLO_CHAT_CAP = 7;
export const SOLO_CHAT_STEP = 10;

/** The existing relay preference service owns delivery, rollback and retry. */
export function SoloWorkspaces({
  session,
  navigator: navigationController,
  scope,
  chats,
  renderChat,
  onNew,
  onConverted,
  visit,
  draft,
  enhanced,
  currentId,
  activity,
  onFilteredCount,
}: {
  enhanced?: SoloNavigationSnapshot | undefined;
  currentId?: string | undefined;
  activity?:
    | { unread: ReadonlySet<string>; working: ReadonlySet<string> }
    | undefined;
  onFilteredCount?: ((count: number) => void) | undefined;
  draft?: { projectId?: string | undefined; content: ReactNode } | undefined;
  onConverted?: ((id: string) => void) | undefined;
  visit?: AbortSignal;
  session: RelaySession;
  navigator?: Navigation | undefined;
  scope: string;
  chats: readonly ChatListItem[];
  renderChat: (
    item: ChatListItem,
    rename: (() => boolean) | undefined,
    annotation?: string,
  ) => ReactNode;
  onNew?: (projectId?: string) => void;
}) {
  useChatConversions(session);
  const handoff = useChannelNavigation();
  const [copy, copyNotice] = useChatCopy();
  const preferences = session.soloPreferences;
  const workspaceMode = !enhanced || enhanced.options.group === "workspace";
  const collapsedKey = "solo:collapsed-projects";
  const expandedKey = "solo:expanded-projects";
  const snapshot = useSyncExternalStore(
    preferences.subscribe,
    preferences.snapshot,
    preferences.snapshot,
  );
  const channels = useSyncExternalStore(
    session.channels.subscribeList,
    session.channels.list,
  );
  useEffect(() => {
    if (channels.status === "ready") void preferences.ensure();
  }, [preferences, channels.status]);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState<string[]>(() => {
    const saved = readView<unknown>(scope, collapsedKey, []);
    return Array.isArray(saved)
      ? saved.filter((id): id is string => typeof id === "string")
      : [];
  });
  // Extra chats each workspace shows past the cap, remembered like collapse.
  const [workspaceExpanded, setWorkspaceExpanded] = useState<
    Record<string, number>
  >(() => {
    const saved = readView<unknown>(scope, expandedKey, {});
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? Object.fromEntries(
          Object.entries(saved).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && entry[1] > 0,
          ),
        )
      : {};
  });
  const [viewCollapsed, setViewCollapsed] = useState<string[]>([]);
  const [viewExpanded, setViewExpanded] = useState<Record<string, number>>({});
  const collapsed = workspaceMode ? workspaceCollapsed : viewCollapsed;
  const setCollapsed = workspaceMode ? setWorkspaceCollapsed : setViewCollapsed;
  const expanded = workspaceMode ? workspaceExpanded : viewExpanded;
  const setExpanded = workspaceMode ? setWorkspaceExpanded : setViewExpanded;
  // Chats listed past the cap (pinned, or just moved in) stay listed until the
  // workspace folds, so a row never disappears while someone is using it.
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const hold = useCallback((ids: readonly string[]) => {
    setHeld((current) =>
      ids.every((id) => current.has(id))
        ? current
        : new Set([...current, ...ids]),
    );
  }, []);
  const [sharing, setSharing] = useState<{
    id: string;
    visit: AbortSignal | undefined;
  }>();
  const sharingChannel = channels.channels.find(
    (channel) => channel.id === sharing?.id,
  );
  const [converting, setConverting] = useState<{
    id: string;
    visit: AbortSignal | undefined;
  }>();
  const currentVisit = useRef(visit);
  currentVisit.current = visit;
  const [chatSettings, setChatSettings] = useState<{
    item: ChatListItem;
    visit: AbortSignal | undefined;
  }>();
  const [renaming, setRenaming] = useState<string>();
  if (renaming && !chats.some((chat) => chat.id === renaming))
    setRenaming(undefined);
  const [deleting, setDeleting] = useState<string>();
  const [projectError, setProjectError] = useState("");
  const [readError, setReadError] = useState<{ id: string; message: string }>();
  const [animate, setAnimate] = useState(false);
  const [rowFocus, setRowFocus] = useState<string>();
  useLayoutEffect(() => {
    if (!rowFocus) return;
    const project = displayedGroup(rowFocus) ?? "";
    // Resolve against current visibility when focus is restored, including when
    // collapse was requested after the asynchronous save began.
    const target = collapsed.includes(project)
      ? `project-${project}`
      : rowFocus;
    const candidates = [
      target,
      ...(enhanced ? soloAncestors(enhanced.forest, rowFocus) : []),
      `project-${project}`,
    ];
    soloFocusTarget(candidates)?.focus({ preventScroll: true });
    setRowFocus(undefined);
  });
  // Show more and Show less each unmount once spent; focus stays on the row,
  // or moves to the workspace's last chat when nothing is left to show or fold.
  const [stepFocus, setStepFocus] = useState<string>();
  useLayoutEffect(() => {
    if (stepFocus === undefined) return;
    setStepFocus(undefined);
    const row = document.querySelector<HTMLElement>(
      `[data-solo-show-more="${CSS.escape(stepFocus)}"]`,
    );
    if (row?.contains(document.activeElement)) return;
    const panel = document.querySelector(
      `[data-solo-project="${CSS.escape(stepFocus)}"]`,
    );
    const chats = panel?.querySelectorAll("[data-solo-menu-id]") ?? [];
    const target =
      row?.querySelector<HTMLElement>("button") ??
      [...chats].at(-1)?.querySelector<HTMLElement>("button");
    target?.focus({ preventScroll: true });
  }, [stepFocus]);
  const [creatingFor, setCreatingFor] = useState<ChatListItem>();
  const [settingsFor, setSettingsFor] = useState<{
    id: string;
    name: string;
  }>();
  const groups = snapshot.data?.sections ?? [];
  const assigned = snapshot.data?.assignments ?? {};
  const ids = new Set(groups.map((group) => group.id));
  const draftProject = draft
    ? ids.has(draft.projectId ?? "")
      ? (draft.projectId ?? "")
      : ""
    : undefined;
  const retained = [
    renaming,
    creatingFor?.id,
    chatSettings?.item.id,
    sharing?.id,
    converting?.id,
  ].filter((id): id is string => !!id);
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const projection = enhanced
    ? projectSolo(
        enhanced.forest,
        channels.channels.filter((channel) => byId.has(channel.id)),
        enhanced.options,
        currentId,
        retained,
      )
    : undefined;
  useEffect(
    () => onFilteredCount?.(projection?.excluded ?? 0),
    [onFilteredCount, projection?.excluded],
  );
  const branchIds = (id: string): string[] => [
    id,
    ...(projection?.children.get(id) ?? []).flatMap((child) =>
      branchIds(child),
    ),
  ];
  const roots = projection
    ? projection.roots.flatMap((id) => {
        const item = byId.get(id);
        return item
          ? [
              {
                ...item,
                pinned: branchIds(id).some(
                  (child) =>
                    (projection.matching.has(child) &&
                      byId.get(child)?.pinned) ||
                    child === currentId ||
                    retained.includes(child) ||
                    held.has(child),
                ),
              },
            ]
          : [];
      })
    : chats;
  const workspaceProjects = [
    ...groups.map((group) => ({
      ...group,
      rows: roots.filter((item) => assigned[item.id] === group.id),
    })),
    {
      id: "",
      name: "Chats",
      rows: roots.filter((item) => !ids.has(assigned[item.id] ?? "")),
    },
  ];
  const projects = workspaceMode
    ? workspaceProjects
    : enhanced?.options.group === "none"
      ? [{ id: "@none", name: "Chats", rows: roots }]
      : [
          ...Object.entries(SOLO_STATUS_LABELS).map(([status, name]) => ({
            id: `@status:${status}`,
            name,
            rows: roots.filter(
              (item) => enhanced?.forest.tasks.get(item.id)?.status === status,
            ),
          })),
          {
            id: "@chats",
            name: "Chats",
            rows: roots.filter((item) => !enhanced?.forest.tasks.has(item.id)),
          },
        ].filter(
          (group) => group.rows.length || (draft && group.id === "@chats"),
        );
  const displayedDraft = draft
    ? workspaceMode
      ? draftProject
      : enhanced?.options.group === "none"
        ? "@none"
        : "@chats"
    : undefined;
  useEffect(() => {
    if (displayedDraft === undefined) return;
    setCollapsed((current) => {
      if (!current.includes(displayedDraft)) return current;
      const next = current.filter((id) => id !== displayedDraft);
      if (workspaceMode) writeView(scope, collapsedKey, next);
      return next;
    });
  }, [displayedDraft, scope, setCollapsed, workspaceMode]);
  const displayedGroup = (id: string) =>
    projects.find((project) =>
      project.rows.some((root) => branchIds(root.id).includes(id)),
    )?.id;
  const [workersOpen, setWorkersOpen] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useSyncExternalStore(
    navigationController?.subscribe ?? noSubscription,
    () => {
      const state = navigationController?.snapshot();
      return JSON.stringify([
        state?.attempt.id,
        state?.status,
        state?.entry?.target,
      ]);
    },
  );
  const navigation = navigationController?.snapshot();
  const currentPath = enhanced ? soloAncestors(enhanced.forest, currentId) : [];
  const pathKey = JSON.stringify(currentPath);
  const accepted = useRef<{
    attempt?: string | undefined;
    task?: string | undefined;
    path?: string | undefined;
    owner?: string | undefined;
  }>({});
  const owner = enhanced
    ? `${enhanced.enhancement.key}:${enhanced.enhancement.revision}`
    : undefined;
  useLayoutEffect(() => {
    const previous = accepted.current;
    const task =
      navigation?.entry?.target.kind === "conversation" &&
      enhanced?.forest.tasks.has(navigation.entry.target.channelId)
        ? navigation.entry.target.channelId
        : undefined;
    const successful =
      navigation?.status === "opened" &&
      navigation.attempt.id !== previous.attempt;
    setWorkersOpen((current) => {
      let next = new Set(
        [...current].filter((id) => enhanced?.forest.tasks.has(id)),
      );
      if (owner !== previous.owner) next = new Set(currentPath);
      if (successful) {
        const path =
          task && enhanced ? soloAncestors(enhanced.forest, task) : [];
        next =
          task === previous.task ? new Set([...next, ...path]) : new Set(path);
      } else if (pathKey !== previous.path)
        for (const id of currentPath) next.add(id);
      return next.size === current.size &&
        [...next].every((id) => current.has(id))
        ? current
        : next;
    });
    accepted.current = {
      attempt: successful ? navigation?.attempt.id : previous.attempt,
      task: successful ? task : previous.task,
      path: pathKey,
      owner,
    };
  }, [navigation, owner, pathKey, enhanced, currentPath]);
  const revealGroup = displayedGroup(currentId ?? "");
  const placementKey = JSON.stringify([owner, revealGroup, pathKey]);
  const previousPlacement = useRef(placementKey);
  useLayoutEffect(() => {
    if (previousPlacement.current === placementKey) return;
    previousPlacement.current = placementKey;
    const row = currentId
      ? document.querySelector<HTMLElement>(
          `[data-solo-menu-id="${CSS.escape(currentId)}"]`,
        )
      : null;
    if (row) requestSidebarPlacementReveal(row);
  }, [placementKey, currentId]);
  useLayoutEffect(() => {
    if (revealGroup !== undefined)
      setCollapsed((current) => current.filter((id) => id !== revealGroup));
  }, [revealGroup, setCollapsed]);
  // A collapse request takes effect after the editor closes. Keep its draft and
  // save owner mounted and reachable, including when a save needs recovery.
  const renamingProject = renaming ? displayedGroup(renaming) : undefined;
  const move = (id: string, projectId?: string) => {
    const follows = prepareSoloMove(session, id);
    if (follows) {
      setProjectError(follows);
      return;
    }

    const saving = preferences.assign(id, projectId);
    openWorkspace(projectId ?? "");
    hold([id]);
    setRowFocus(id);
    void saving.catch(() => {
      // A rollback remounts the original row. Do not steal focus if the user moved on.
      if (
        !document.querySelector(`[data-solo-menu-id="${id}"]`) ||
        document.activeElement !== document.body
      )
        return;
      setRowFocus(id);
    });
  };
  // Matches the open chat's own actions menu: leaving the open chat returns to
  // a new Solo draft, unless the user has already moved on.
  const chooseLifecycle = (
    channel: ChannelSummary,
    action: ChannelLifecycleAction,
  ) => {
    const trigger =
      document.querySelector<HTMLElement>(
        `[data-solo-menu-id="${CSS.escape(channel.id)}"] button`,
      ) ?? undefined;
    const current = navigationController?.snapshot();
    const leavesOpenChat =
      action !== "unarchive" &&
      current?.entry.target.kind === "conversation" &&
      current.entry.target.channelId === channel.id;
    // Let the menu restore focus before opening confirmation.
    requestAnimationFrame(() =>
      handoff?.openLifecycle(channel, action, trigger, undefined, {
        close() {
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        },
        completed() {
          if (leavesOpenChat && !current.attempt.signal.aborted)
            void navigationController?.open(soloDraftTarget(scope));
        },
      }),
    );
  };
  const openWorkspace = (id: string) => {
    const next = workspaceCollapsed.filter((key) => key !== id);
    setWorkspaceCollapsed(next);
    writeView(scope, collapsedKey, next);
  };
  const toggle = (id: string, open: boolean) => {
    const next = collapsed.filter((key) => key !== id);
    if (!open) next.push(id);
    setCollapsed(next);
    if (workspaceMode) writeView(scope, collapsedKey, next);
  };
  const expand = (id: string, extra: number) => {
    const rest = Object.fromEntries(
      Object.entries(expanded).filter(([key]) => key !== id),
    );
    const next = extra > 0 ? { ...rest, [id]: extra } : rest;
    setExpanded(next);
    if (workspaceMode) writeView(scope, expandedKey, next);
    if (extra === 0) {
      // Folding releases retained chats; ones still pinned stay held.
      const rows = new Set(
        projects
          .find((project) => project.id === id)
          ?.rows.filter((item) => !item.pinned)
          .map((item) => item.id),
      );
      setHeld(
        (current) => new Set([...current].filter((key) => !rows.has(key))),
      );
    }
    setStepFocus(id);
  };
  const visible = projects
    .filter(
      (project) =>
        (workspaceMode && project.id) ||
        project.rows.length ||
        displayedDraft === project.id,
    )
    .map((project) => {
      // A list that shrank back under the cap has nothing to fold.
      const extra =
        project.rows.length > SOLO_CHAT_CAP ? (expanded[project.id] ?? 0) : 0;
      const limit = SOLO_CHAT_CAP + extra;
      // Rows arrive newest first; chats kept past the cap keep that order.
      const listed = project.rows.filter(
        (item, index) =>
          index < limit ||
          item.pinned ||
          branchIds(item.id).includes(renaming ?? "") ||
          held.has(item.id),
      );
      return {
        ...project,
        listed,
        extra,
        overflow: listed.slice(limit).map((item) => item.id),
        // Retained chats that are no longer pinned can fold even when unexpanded.
        foldable:
          extra > 0 ||
          listed
            .slice(limit)
            .some((item) => !item.pinned && item.id !== renaming),
        hidden: project.rows.length - listed.length,
      };
    });
  const overflow = visible.flatMap((project) => project.overflow).join(" ");
  useEffect(() => {
    if (overflow) hold(overflow.split(" "));
  }, [overflow, hold]);
  const previousFocus = useRef<
    | { element: HTMLElement; id: string; ancestors: readonly string[] }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    const previous = previousFocus.current;
    if (
      previous &&
      (!previous.element.isConnected || previous.element.closest("[hidden]")) &&
      (document.activeElement === document.body ||
        document.activeElement === previous.element)
    ) {
      soloFocusTarget([
        previous.id,
        ...(enhanced ? soloAncestors(enhanced.forest, previous.id) : []),
        ...previous.ancestors,
      ])?.focus({ preventScroll: true });
    }
  });
  const moves =
    snapshot.moves?.filter((move) =>
      chats.some((item) => item.id === move.channelId),
    ) ?? [];
  const renderItem = (
    item: ChatListItem,
    project: { id: string; name: string },
    depth = 0,
    isVisible = true,
  ): ReactNode => {
    const children = projection?.children.get(item.id) ?? [];
    const cardExpanded = item.id === currentId || currentPath.includes(item.id);
    const childrenOpen = cardExpanded && workersOpen.has(item.id);
    const containsRename = !!renaming && branchIds(item.id).includes(renaming);
    const hidden = branchIds(item.id)
      .slice(1)
      .filter((id) => {
        for (const parent of enhanced
          ? soloAncestors(enhanced.forest, id)
          : []) {
          if (
            !workersOpen.has(parent) ||
            (parent !== currentId && !currentPath.includes(parent))
          )
            return true;
          if (parent === item.id) return false;
        }
        return false;
      });
    const unread = hidden.filter(
      (id) => projection?.matching.has(id) && activity?.unread.has(id),
    ).length;
    const working = hidden.filter(
      (id) => projection?.matching.has(id) && activity?.working.has(id),
    ).length;
    const hiddenActivity = [
      unread ? `${unread} unread` : "",
      working ? `${working} working` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const channel = channels.channels.find((channel) => channel.id === item.id);
    if (renaming === item.id)
      return (
        <SoloChatName
          key={item.id}
          session={session}
          id={item.id}
          title={item.title}
          close={(focus) => {
            setRenaming(undefined);
            if (focus) setRowFocus(item.id);
          }}
        />
      );
    const row = (
      <ChatActionsMenu
        key={item.id}
        id={item.id}
        title={item.title}
        indicator={<ChatSharedMark session={session} channel={channel} />}
        className={styles.organizedRow}
        card={enhanced?.forest.tasks.has(item.id)}
        visible={isVisible}
        focusPath={enhanced ? soloAncestors(enhanced.forest, item.id) : []}
        trailing={
          cardExpanded &&
          (enhanced?.forest.children.get(item.id)?.length ?? 0) > 0 && (
            <div className={styles.workerFooter}>
              <Button
                variant="plain"
                size="inline"
                data-workers-control={item.id}
                aria-expanded={childrenOpen}
                aria-controls={`solo-workers-${item.id}`}
                onClick={() => {
                  if (childrenOpen) {
                    const panel = document.getElementById(
                      `solo-workers-${item.id}`,
                    );
                    if (panel?.contains(document.activeElement))
                      document
                        .querySelector<HTMLElement>(
                          `[data-workers-control="${CSS.escape(item.id)}"]`,
                        )
                        ?.focus({ preventScroll: true });
                  }
                  setWorkersOpen((current) => {
                    const next = new Set(current);
                    if (childrenOpen)
                      for (const id of branchIds(item.id)) next.delete(id);
                    else next.add(item.id);
                    return next;
                  });
                }}
              >
                <CaretDownIcon size={14} aria-hidden="true" />
                {children.length !==
                enhanced?.forest.children.get(item.id)?.length
                  ? `${children.length} of `
                  : ""}
                {enhanced?.forest.children.get(item.id)?.length}{" "}
                {enhanced?.forest.children.get(item.id)?.length === 1
                  ? enhanced?.enhancement.childNoun.one
                  : enhanced?.enhancement.childNoun.other}
                {hiddenActivity ? ` · ${hiddenActivity}` : ""}
              </Button>
            </div>
          )
        }
        content={
          channel && (
            <SoloChatMenuItems
              session={session}
              channel={channel}
              menuOwner={item.id}
              onShare={() => setSharing({ id: item.id, visit })}
              onConvert={() => setConverting({ id: item.id, visit })}
              onMove={(projectId) => move(item.id, projectId)}
              onNewWorkspace={() => setCreatingFor(item)}
              onMoveBlocked={setProjectError}
              onCopy={copy}
              onSettings={() => setChatSettings({ item, visit })}
              onLifecycle={
                handoff && ((action) => chooseLifecycle(channel, action))
              }
              onReadResult={(error) =>
                setReadError((current) =>
                  error
                    ? { id: item.id, message: error }
                    : current?.id === item.id
                      ? undefined
                      : current,
                )
              }
            />
          )
        }
      >
        <DraggableChannel
          disabled={!workspaceMode || !!enhanced?.forest.parents.has(item.id)}
          channelId={item.id}
          sectionKey={DROP + project.id}
        >
          {renderChat(
            item,
            !renaming &&
              deleting !== project.id &&
              canEditLifetime(session, channel)
              ? () => {
                  if (
                    renaming ||
                    deleting === project.id ||
                    !canEditLifetime(session, channel)
                  )
                    return false;
                  setRenaming(item.id);
                  return true;
                }
              : undefined,
            [
              projection?.outside === item.id
                ? "Open chat — outside filter"
                : "",
              projection?.context.has(item.id) ? "Context" : "",
              currentPath.includes(item.id) ? "Contains current task" : "",
              !cardExpanded ? hiddenActivity : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          )}
        </DraggableChannel>
      </ChatActionsMenu>
    );

    return (
      <div key={item.id} data-solo-branch-id={item.id}>
        {row}
        {(enhanced?.forest.children.get(item.id)?.length ?? 0) > 0 && (
          <div
            id={`solo-workers-${item.id}`}
            hidden={!childrenOpen && !containsRename}
            className={depth < 3 ? styles.workerChildren : undefined}
          >
            {children.map((id) => {
              const child = byId.get(id);
              return child
                ? renderItem(
                    child,
                    project,
                    depth + 1,
                    isVisible && (childrenOpen || containsRename),
                  )
                : null;
            })}
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      {(snapshot.status === "idle" || snapshot.status === "loading") && (
        <p role="status" className={styles.listMessage}>
          Loading workspaces…
        </p>
      )}
      {snapshot.status === "error" && (
        <div role="alert" className={styles.listMessage}>
          <p>{snapshot.error ?? "Workspaces couldn’t load."}</p>
          <Button onClick={() => void preferences.refresh()}>
            Retry workspaces
          </Button>
        </div>
      )}
      {projectError && (
        <p role="alert" className={styles.listMessage}>
          {projectError}
        </p>
      )}
      {readError && (
        <p role="alert" className={styles.listMessage}>
          {readError.message}
        </p>
      )}
      <div
        onFocusCapture={(event) => {
          const element = event.target;
          const branch = element.closest<HTMLElement>("[data-solo-branch-id]");
          const id =
            branch?.dataset.soloBranchId ??
            element.closest<HTMLElement>("[data-solo-menu-owner]")?.dataset
              .soloMenuOwner;
          previousFocus.current = id
            ? {
                element,
                id,
                ancestors: enhanced ? soloAncestors(enhanced.forest, id) : [],
              }
            : undefined;
        }}
        onBlurCapture={(event) => {
          // A null destination can mean React is removing the focused row.
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            previousFocus.current = undefined;
        }}
      >
        <ChannelSidebarDnd
          writable={preferences.writable && workspaceMode}
          onMove={(id, key) => move(id, key.slice(DROP.length) || undefined)}
          // Solo projects keep their saved order; only chats drag.
          onReorder={() => {}}
          overlay={(id) => {
            const item = chats.find((item) => item.id === id);
            return (
              item && (
                <div className={channelStyles.channelDragOverlay}>
                  <span>{item.title}</span>
                </div>
              )
            );
          }}
        >
          {visible.map((project) => (
            <DropProject
              projectKey={DROP + project.id}
              dropEnabled={workspaceMode}
              key={project.id}
              className={`${styles.project} ${channelStyles.channelSection}`}
              data-project={project.id ? "" : undefined}
              open={
                !collapsed.includes(project.id) ||
                renamingProject === project.id
              }
              onOpenChange={(open) =>
                toggle(
                  project.id,
                  renamingProject === project.id
                    ? collapsed.includes(project.id)
                    : open,
                )
              }
              data-animate={animate || undefined}
            >
              <ChatActionsMenu
                id={`project-${project.id}`}
                title={project.name}
                className={`${channelStyles.sectionHeader} ${styles.projectHeader}`}
                enabled={workspaceMode && !!project.id}
                trailing={
                  <div className={channelStyles.sectionActions}>
                    {onNew && workspaceMode && (
                      <IconButton
                        size="compact"
                        aria-label={`New chat in ${project.name}`}
                        title="New chat"
                        icon={<PlusIcon size={15} strokeWidth={2.5} />}
                        onClick={() => onNew(project.id || undefined)}
                      />
                    )}
                  </div>
                }
                content={
                  <>
                    <MenuItem onClick={() => setSettingsFor(project)}>
                      Workspace settings…
                    </MenuItem>
                    <MenuItem
                      tone="danger"
                      data-delete-solo-project=""
                      disabled={
                        !preferences.sectionRemovalWritable ||
                        !!deleting ||
                        renamingProject === project.id
                      }
                      onClick={() => {
                        setDeleting(project.id);
                        setProjectError("");
                        void preferences
                          .removeSection(project.id)
                          .catch((error: unknown) => {
                            setProjectError(
                              error instanceof Error
                                ? error.message
                                : "Workspace could not be deleted. Try again.",
                            );
                          })
                          .finally(() => setDeleting(undefined));
                      }}
                    >
                      Delete workspace
                    </MenuItem>
                  </>
                }
              >
                <Collapsible.Trigger
                  hidden={!workspaceMode && enhanced?.options.group === "none"}
                  type="button"
                  className={`${channelStyles.sidebarSectionHeading} ${styles.projectHeading}`}
                  aria-expanded={
                    !collapsed.includes(project.id) ||
                    renamingProject === project.id
                  }
                  onClick={(event) => setAnimate(event.detail > 0)}
                >
                  <span className={channelStyles.sectionTitle}>
                    {project.name}
                  </span>
                  <span
                    className={channelStyles.sectionChevron}
                    aria-hidden="true"
                  >
                    <CaretDownIcon size={15} strokeWidth={2.5} />
                  </span>
                </Collapsible.Trigger>
              </ChatActionsMenu>
              <Collapsible.Panel
                className={styles.projectPanel}
                data-solo-project={project.id}
              >
                {displayedDraft === project.id && draft && (
                  <ChatActionsMenu
                    id="new-chat-draft"
                    title="New chat"
                    className={styles.organizedRow}
                    content={null}
                    enabled={false}
                  >
                    <div>{draft.content}</div>
                  </ChatActionsMenu>
                )}
                {project.listed.map((item) => renderItem(item, project))}
                {(project.hidden > 0 || project.foldable) && (
                  <div
                    className={styles.showMore}
                    data-solo-show-more={project.id}
                  >
                    {project.hidden > 0 && (
                      <NavigationItem
                        variant="text"
                        data-solo-show-more-expand=""
                        label={
                          enhanced
                            ? `Show more · ${project.hidden} roots`
                            : "Show more"
                        }
                        aria-label={`Show more ${enhanced ? "roots" : "chats"} in ${project.name}`}
                        icon={
                          <span
                            className={styles.conversationIcon}
                            aria-hidden="true"
                          >
                            <CaretDownIcon size={16} />
                          </span>
                        }
                        onClick={() =>
                          expand(project.id, project.extra + SOLO_CHAT_STEP)
                        }
                      />
                    )}
                    {project.foldable && (
                      <NavigationItem
                        variant="text"
                        data-solo-show-more-fold=""
                        label="Show less"
                        aria-label={`Show fewer chats in ${project.name}`}
                        onClick={() => expand(project.id, 0)}
                      />
                    )}
                  </div>
                )}
                {!project.rows.length &&
                  workspaceMode &&
                  project.id &&
                  (onNew ? (
                    // An empty project offers its way out instead of an empty state.
                    <NavigationItem
                      variant="row"
                      label="New chat"
                      aria-label={`New chat in ${project.name}`}
                      title={`New chat in ${project.name}`}
                      icon={
                        <span className={styles.conversationIcon}>
                          <PlusIcon size={16} strokeWidth={2.5} />
                        </span>
                      }
                      onClick={() => onNew(project.id)}
                    />
                  ) : (
                    <p className={styles.listMessage}>
                      No chats in this workspace.
                    </p>
                  ))}
              </Collapsible.Panel>
            </DropProject>
          ))}
        </ChannelSidebarDnd>
      </div>
      {converting && (
        <ConvertToChannel
          key={converting.id}
          session={session}
          id={converting.id}
          signal={converting.visit}
          onConverted={() => onConverted?.(converting.id)}
          close={() => setConverting(undefined)}
          finalFocus={() =>
            document.querySelector<HTMLElement>(
              `[data-solo-menu-id="${converting.id}"] button`,
            ) ?? false
          }
        />
      )}
      {sharing && sharingChannel && (
        <ChannelMembersDialog
          key={sharing.id}
          session={session}
          channelId={sharing.id}
          navigator={navigationController}
          signal={sharing.visit}
          trigger={{
            current: document.querySelector<HTMLElement>(
              `[data-solo-menu-id="${sharing.id}"] button`,
            ),
          }}
          close={() => setSharing(undefined)}
        />
      )}
      {chatSettings && (
        <WorkspaceSettings
          key={chatSettings.item.id}
          signal={chatSettings.visit}
          finalFocus={() =>
            document.querySelector<HTMLElement>(
              `[data-solo-menu-id="${chatSettings.item.id}"] button`,
            ) ?? false
          }
          session={session}
          scope={scope}
          target={{
            kind: "chat",
            id: chatSettings.item.id,
            name: chatSettings.item.title,
          }}
          close={() => setChatSettings(undefined)}
        />
      )}
      {moves.some((move) => move.pending) && (
        <p role="status" className={styles.listMessage}>
          Saving workspace…
        </p>
      )}
      {moves
        .filter((move) => move.error)
        .map((move) => (
          <div role="alert" key={move.id} className={styles.listMessage}>
            <p>{move.error}</p>
            <Button
              disabled={!preferences.writable}
              onClick={() =>
                void preferences.retryMove(move.channelId).catch(() => {})
              }
            >
              Retry move
            </Button>
            <Button
              onClick={() => preferences.dismissMoveError(move.channelId)}
            >
              Dismiss
            </Button>
          </div>
        ))}
      {copyNotice}
      {settingsFor && (
        <WorkspaceSettings
          key={settingsFor.id}
          session={session}
          scope={scope}
          target={{ kind: "project", ...settingsFor }}
          close={() => setSettingsFor(undefined)}
        />
      )}
      {creatingFor && (
        <NewWorkspaceDialog
          key={creatingFor.id}
          name={creatingFor.title}
          close={() => setCreatingFor(undefined)}
          create={(name) => {
            if (!preferences.writable) return false;
            const follows = prepareSoloMove(session, creatingFor.id);
            if (follows) {
              setProjectError(follows);
              setCreatingFor(undefined);
              return true;
            }
            const id = crypto.randomUUID();
            void preferences
              .createAndAssign(creatingFor.id, { id, name })
              .catch(() => {});
            openWorkspace(id);
            setCreatingFor(undefined);
            return true;
          }}
        />
      )}
    </>
  );
}

const DROP = "project:";
const noSubscription = () => () => {};

/** Resolve after layout, including when the old row was hidden or replaced. */
function soloFocusTarget(ids: readonly string[]) {
  return (
    ids
      .map((id) =>
        document.querySelector<HTMLElement>(
          `[data-solo-menu-id="${CSS.escape(id)}"] button`,
        ),
      )
      .find((element) => element && !element.closest("[hidden]")) ??
    document.querySelector<HTMLElement>("[data-solo-collection-control]")
  );
}

/** A drop reports only its destination, so it saves exactly like Move to. */
function DropProject({
  projectKey,
  dropEnabled = true,
  ...props
}: ComponentProps<typeof Collapsible.Root> & {
  projectKey: string;
  dropEnabled?: boolean;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: projectKey,
    disabled: !dropEnabled,
  });
  return (
    <Collapsible.Root
      {...props}
      ref={setNodeRef}
      data-drop-target={
        (isOver && active?.data.current?.sectionKey !== projectKey) || undefined
      }
    />
  );
}

/** Both entry points use one action list; right-click never selects the row. */
function ChatActionsMenu({
  id,
  title,
  className,
  children,
  content,
  indicator,
  enabled = true,
  trailing,
  card,
  visible = true,
  focusPath = [],
}: {
  visible?: boolean | undefined;
  focusPath?: readonly string[] | undefined;
  card?: boolean | undefined;
  id: string;
  title: string;
  className: string | undefined;
  children: ReactNode;
  content: ReactNode;
  indicator?: ReactNode;
  enabled?: boolean;
  /** Follows the overflow action, preserving header action keyboard order. */
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement>();
  const [overflowOpen, setOverflowOpen] = useState(false);
  useEffect(() => {
    if (!visible) {
      setOpen(false);
      setOverflowOpen(false);
    }
  }, [visible]);
  const restoreFocus = () => soloFocusTarget([id, ...focusPath]) ?? false;
  if (!enabled)
    return (
      <div className={className} data-solo-menu-id={id}>
        {children}
        {trailing}
      </div>
    );
  return (
    <ContextMenuRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAnchor(undefined);
      }}
    >
      <ContextMenuTrigger
        render={
          card ? (
            <NavigationCard
              className={className}
              data-solo-menu-id={id}
              footer={trailing}
            />
          ) : (
            <div className={className} data-solo-menu-id={id} />
          )
        }
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            event.stopPropagation();
            setAnchor(event.currentTarget);
            setOpen(true);
          }
        }}
      >
        {children}
        {indicator}
        <MenuRoot open={overflowOpen} onOpenChange={setOverflowOpen}>
          <MenuTrigger
            render={(props) => (
              <IconButton
                {...props}
                data-solo-row-action=""
                variant="bare"
                size="compact"
                data-solo-overflow-action=""
                aria-label={`Actions for ${title}`}
                icon={<DotsThreeIcon size={15} strokeWidth={2.5} />}
              />
            )}
          />
          <MenuPopup
            aria-label={`Actions for ${title}`}
            data-solo-menu-owner={id}
            align="end"
            finalFocus={restoreFocus}
          >
            {content}
          </MenuPopup>
        </MenuRoot>
        {!card && trailing}
      </ContextMenuTrigger>
      <MenuPopup
        aria-label={`Actions for ${title}`}
        data-solo-menu-owner={id}
        anchor={anchor}
        finalFocus={restoreFocus}
      >
        {content}
      </MenuPopup>
    </ContextMenuRoot>
  );
}
