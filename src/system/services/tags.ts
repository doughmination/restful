/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import type { PKObject } from "../types";
import { rt } from "../runtime";

type MemberTagsMap = Record<string, string[]>;

const KEY = "member_tags";
const DEFAULT_MEMBER_TAGS: MemberTagsMap = { C1: ["Host"] };

export async function getMemberTags(): Promise<MemberTagsMap> {
  const stored = await rt().store.get<MemberTagsMap | null>(KEY, null);
  if (!stored) {
    await saveMemberTags(DEFAULT_MEMBER_TAGS);
    return { ...DEFAULT_MEMBER_TAGS };
  }
  return stored;
}

export async function saveMemberTags(memberTags: MemberTagsMap): Promise<void> {
  await rt().store.put(KEY, memberTags);
}

export async function getMemberTagsById(memberId: string, memberName: string): Promise<string[]> {
  const memberTags = await getMemberTags();
  if (memberName in memberTags) return memberTags[memberName];
  if (memberId in memberTags) return memberTags[memberId];
  return [];
}

export async function updateMemberTags(memberIdentifier: string, tags: string[]): Promise<boolean> {
  const memberTags = await getMemberTags();
  memberTags[memberIdentifier] = tags;
  await saveMemberTags(memberTags);
  return true;
}

export async function addMemberTag(memberIdentifier: string, tag: string): Promise<boolean> {
  const memberTags = await getMemberTags();
  if (!(memberIdentifier in memberTags)) memberTags[memberIdentifier] = [];
  if (!memberTags[memberIdentifier].includes(tag)) {
    memberTags[memberIdentifier].push(tag);
    await saveMemberTags(memberTags);
    return true;
  }
  return false;
}

export async function removeMemberTag(memberIdentifier: string, tag: string): Promise<boolean> {
  const memberTags = await getMemberTags();
  const tags = memberTags[memberIdentifier];
  if (tags && tags.includes(tag)) {
    memberTags[memberIdentifier] = tags.filter((t) => t !== tag);
    await saveMemberTags(memberTags);
    return true;
  }
  return false;
}

export async function enrichMembersWithTags(members: PKObject[]): Promise<PKObject[]> {
  const enriched: PKObject[] = [];
  for (const member of members) {
    const tags = await getMemberTagsById(member.id ?? "", member.name ?? "");
    enriched.push({ ...member, tags });
  }
  return enriched;
}
