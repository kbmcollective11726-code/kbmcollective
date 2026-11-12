import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EVENT_KEY_PATTERN = new RegExp(`^event-photos/(${UUID_SOURCE})/(.+)$`, "i");
const AVATAR_KEY_PATTERN = new RegExp(`^avatars/(${UUID_SOURCE})/avatar_\\d+\\.(?:jpe?g|png)$`, "i");
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

export interface R2UploadAuthorization {
  allowed: boolean;
  reason?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function authorizeR2Upload(
  client: SupabaseClient,
  userId: string,
  key: string,
  contentType: string,
): Promise<R2UploadAuthorization> {
  if (
    !key ||
    key.length > 500 ||
    key.includes("..") ||
    key.startsWith("/") ||
    key.includes("\\") ||
    !ALLOWED_CONTENT_TYPES.has(contentType)
  ) {
    return { allowed: false, reason: "Invalid image path or content type." };
  }

  const avatarMatch = key.match(AVATAR_KEY_PATTERN);
  if (avatarMatch) {
    return avatarMatch[1]?.toLowerCase() === userId.toLowerCase()
      ? { allowed: true }
      : { allowed: false, reason: "Avatar path must belong to the signed-in user." };
  }

  const eventMatch = key.match(EVENT_KEY_PATTERN);
  if (!eventMatch) {
    return { allowed: false, reason: "Unsupported image path." };
  }

  const eventId = eventMatch[1]!;
  const relativePath = eventMatch[2]!;
  const escapedUserId = escapeRegExp(userId);
  const ownedFile = `${escapedUserId}_\\d+\\.(?:jpe?g|png)`;
  const memberPathPattern = new RegExp(
    `^(?:${ownedFile}|(?:chat|group-chat|vendor-logos|registration-headshots)/${ownedFile})$`,
    "i",
  );
  const registrantPathPattern = new RegExp(
    `^(?:vendor-logos|registration-headshots)/${ownedFile}$`,
    "i",
  );
  const adminPathPattern = new RegExp(
    `^(?:banner_\\d+\\.jpe?g|badge_banner_\\d+\\.jpe?g|portal_banner_\\d+\\.jpe?g|${ownedFile}|(?:chat|group-chat|vendor-logos|registration-headshots|sponsor-logos)/${ownedFile})$`,
    "i",
  );

  const [
    { data: platformAdmin },
    { data: eventAdmin },
    { data: membership },
    { data: registration },
    { data: matchmakingSettings },
  ] = await Promise.all([
    client.rpc("is_platform_admin", { p_user_id: userId }),
    client.rpc("is_event_admin", { p_event_id: eventId }),
    client.from("event_members").select("user_id").eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    client.from("event_registration_submissions").select("id").eq("event_id", eventId).eq("user_id", userId).limit(1).maybeSingle(),
    client
      .from("event_matchmaking_settings")
      .select("registration_open")
      .eq("event_id", eventId)
      .maybeSingle(),
  ]);

  if (platformAdmin === true || eventAdmin === true) {
    return adminPathPattern.test(relativePath)
      ? { allowed: true }
      : { allowed: false, reason: "Image path is not allowed for this event." };
  }
  if (membership) {
    return memberPathPattern.test(relativePath)
      ? { allowed: true }
      : { allowed: false, reason: "Image path is not allowed for event members." };
  }
  if (registration || (matchmakingSettings as { registration_open?: boolean } | null)?.registration_open) {
    return registrantPathPattern.test(relativePath)
      ? { allowed: true }
      : { allowed: false, reason: "Registration uploads must use the assigned event folder." };
  }
  return { allowed: false, reason: "You do not have access to upload images for this event." };
}
