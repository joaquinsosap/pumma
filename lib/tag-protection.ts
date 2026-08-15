import { isLifeTag } from "@/lib/life-area-sync";

/**
 * Whether a tag can be deleted, and if not, why.
 *
 * One function because there used to be two rules and they disagreed. The
 * server refused by NAME — personal and work are the life-area split itself,
 * not labels — while the settings list decided by the stored `isDefault`
 * flag. On any account old enough that its life tags predate the flag, the
 * screen offered a delete button for `personal` that the server then refused,
 * and hid the button on whatever else happened to carry a stale flag.
 *
 * `isDefault` is deliberately NOT a rule here. It is a display fact about how
 * a tag arrived, it has drifted on real accounts, and a flag nobody can see
 * or change should never be the thing standing between a user and deleting
 * their own label. What must not be deleted is what the app would break
 * without: the life tags, and a project's own tag.
 */
export function tagDeleteBlock(tag: {
  name: string;
  isProjectPrimary?: boolean;
}): string | null {
  if (isLifeTag(tag.name)) {
    return `"${tag.name}" is a life tag and can't be deleted`;
  }
  if (tag.isProjectPrimary) {
    return "That's the project's own tag, so rename it or delete the project";
  }
  return null;
}

/**
 * Whether the list should badge this tag as one of the app's own.
 *
 * Reads the name rather than the flag, for the same reason: the two life tags
 * are the ones every account has and nobody chose, and that is true whatever
 * a row happens to say about itself.
 */
export function isBuiltInTag(tag: { name: string }): boolean {
  return isLifeTag(tag.name);
}
