import { colorFor, initials } from "@/lib/format";

/**
 * A person's avatar: their uploaded photo when set, otherwise their initials on
 * a stable color derived from their id. Drop-in replacement for the inline
 * `<span className="avatar">…</span>` pattern used across the app — pass the
 * same size-modifier class (e.g. "avatar-sm") through `className`.
 */
export function Avatar({
  name,
  id,
  avatarUrl,
  className,
  title,
}: {
  name: string;
  id: string;
  avatarUrl?: string | null;
  className?: string;
  title?: string;
}): React.ReactElement {
  const cls = `avatar${className ? ` ${className}` : ""}`;
  if (avatarUrl) {
    return (
      <span className={cls} title={title} style={{ padding: 0, overflow: "hidden" }}>
        <img
          src={avatarUrl}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </span>
    );
  }
  return (
    <span className={cls} title={title} style={{ background: colorFor(id) }}>
      {initials(name)}
    </span>
  );
}
