import { randomBytes } from "crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 10): string {
  const buf = randomBytes(length);
  return Array.from(buf)
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("");
}

export interface InviteValidation {
  valid: boolean;
  reason?: string;
  invite?: {
    id: string;
    team_id: string;
    use_count: number;
    max_uses: number;
    expires_at: string | null;
  };
}

export function validateInvite(invite: {
  revoked_at: string | null;
  expires_at: string | null;
  use_count: number;
  max_uses: number;
} | null | undefined): InviteValidation {
  if (!invite) return { valid: false, reason: "Invite code not found." };
  if (invite.revoked_at)
    return { valid: false, reason: "This invite has been revoked." };
  if (invite.expires_at && new Date(invite.expires_at) < new Date())
    return { valid: false, reason: "This invite has expired." };
  if (invite.use_count >= invite.max_uses)
    return { valid: false, reason: "This invite has reached its use limit." };
  return { valid: true };
}
