import { useMemo, useSyncExternalStore } from "react";
import type { RelaySession } from "../relay/session";
import { selectProfiles } from "../relay/profile-selection";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { QuestionIcon } from "../../shared/design-system/icons";
import { avatarMedia } from "../../shared/avatar-source";
import styles from "../../bundled/channels/SoloWorkspaces.module.css";
import { publicKeyLabels } from "../../shared/identity/public-key";

/** Saved task assignment only; activity and channel membership never choose this identity. */
export function SoloTaskAvatar({
  session,
  agent,
}: {
  session: RelaySession;
  agent?: string | undefined;
}) {
  const selection = useMemo(
    () => selectProfiles(session.profiles, agent ? [agent] : []),
    [session.profiles, agent],
  );
  const profiles = useSyncExternalStore(
    selection.subscribe,
    selection.snapshot,
    selection.snapshot,
  );
  const profile = agent ? profiles.get(agent) : undefined;
  const name =
    profile?.name ??
    (agent ? publicKeyLabels([agent]).get(agent) : undefined) ??
    "Unassigned agent";
  return (
    <span
      className={styles.taskAvatar}
      title={agent ? name : "No primary agent assigned"}
    >
      <Avatar
        src={avatarMedia(profile?.picture, session.media)}
        alt=""
        fallback={name}
        size="fill"
        shape="squircle"
        fallbackContent={!agent ? <QuestionIcon size={14} /> : undefined}
      />
    </span>
  );
}
