import boltAvatar from "@/assets/agent-bolt.jpg";
import leslieAvatar from "@/assets/agent-leslie.jpg";
import rexAvatar from "@/assets/agent-rex.jpg";

export const AGENT_AVATARS: Record<string, string> = {
  bolt: boltAvatar,
  leslie: leslieAvatar,
  rex: rexAvatar,
};

export const avatarFor = (name: string | null | undefined) =>
  name ? AGENT_AVATARS[name.trim().toLowerCase()] : undefined;

export const initialsFor = (name: string | null | undefined) =>
  (name ?? "?")
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
