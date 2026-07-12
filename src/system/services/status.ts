/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import type { PKObject } from "../types";
import { rt } from "../runtime";

interface MemberStatus {
  text: string;
  emoji: string | null;
  updated_at: string;
}

type StatusMap = Record<string, MemberStatus>;

const KEY = "member_status";

export async function getAllStatuses(): Promise<StatusMap> {
  return rt().store.get<StatusMap>(KEY, {});
}

export async function saveAllStatuses(statuses: StatusMap): Promise<void> {
  await rt().store.put(KEY, statuses);
}

export async function getMemberStatus(memberIdentifier: string): Promise<MemberStatus | null> {
  const statuses = await getAllStatuses();
  return statuses[memberIdentifier] ?? null;
}

export async function setMemberStatus(
  memberIdentifier: string,
  statusText: string,
  emoji?: string | null,
): Promise<MemberStatus> {
  const statuses = await getAllStatuses();
  const statusObj: MemberStatus = {
    text: statusText,
    emoji: emoji ?? null,
    updated_at: new Date().toISOString(),
  };
  statuses[memberIdentifier] = statusObj;
  await saveAllStatuses(statuses);
  return statusObj;
}

export async function clearMemberStatus(memberIdentifier: string): Promise<boolean> {
  const statuses = await getAllStatuses();
  if (memberIdentifier in statuses) {
    delete statuses[memberIdentifier];
    await saveAllStatuses(statuses);
    return true;
  }
  return false;
}

export async function enrichMemberWithStatus(member: PKObject): Promise<PKObject> {
  const memberId = member.id;
  const memberName = member.name;

  let status: MemberStatus | null = null;
  if (memberId) status = await getMemberStatus(String(memberId));
  if (!status && memberName) status = await getMemberStatus(memberName);

  return { ...member, status };
}

export async function enrichMembersWithStatus(members: PKObject[]): Promise<PKObject[]> {
  return Promise.all(members.map((member) => enrichMemberWithStatus(member)));
}
