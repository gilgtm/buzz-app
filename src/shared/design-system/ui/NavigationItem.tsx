import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps, ReactNode } from "react";

/** One navigation surface for a primary row and independent sibling controls.
 * The primary NavigationItem still owns focus and aria-current. */
export function NavigationCard({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      data-buzz-ui=""
      data-navigation-card=""
      className={`navigation-card ${className ?? ""}`}
    />
  );
}

export function NavigationItem({
  label,
  icon,
  trailing,
  selected = false,
  highlighted = false,
  inset = false,
  variant = "row",
  ...props
}: {
  label: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  /** Transient picker focus; persistent navigation selection stays separate. */
  highlighted?: boolean;
  inset?: boolean;
  variant?: "row" | "pill" | "option" | "search" | "text";
} & Omit<ComponentProps<typeof BaseButton>, "className" | "children">) {
  return (
    <BaseButton
      {...props}
      type={props.type ?? "button"}
      data-variant={variant}
      data-buzz-ui=""
      className="navigation-item"
      data-selected={selected || undefined}
      data-highlighted={highlighted || undefined}
      data-inset={inset || undefined}
      aria-current={props["aria-current"] ?? (selected ? "page" : undefined)}
    >
      {icon}
      <span className="navigation-item-label">{label}</span>
      {trailing ? (
        <span className="navigation-item-trailing">{trailing}</span>
      ) : null}
    </BaseButton>
  );
}
