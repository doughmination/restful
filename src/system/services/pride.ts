/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import type { PKObject } from "../types";
import { rt } from "../runtime";

type MemberPrideMap = Record<string, string[]>;

const KEY = "member_pride";

const DEFAULT_MEMBER_PRIDE: MemberPrideMap = {};

export async function getMemberPride(): Promise<MemberPrideMap> {
  const stored = await rt().store.get<MemberPrideMap | null>(KEY, null);
  if (!stored) {
    await saveMemberPride(DEFAULT_MEMBER_PRIDE);
    return { ...DEFAULT_MEMBER_PRIDE };
  }
  return stored;
}

export async function saveMemberPride(memberPride: MemberPrideMap): Promise<void> {
  await rt().store.put(KEY, memberPride);
}

export async function getMemberPrideById(
  memberId: string,
  memberName: string,
): Promise<string[]> {
  const memberPride = await getMemberPride();
  if (memberName in memberPride) return memberPride[memberName];
  if (memberId in memberPride) return memberPride[memberId];
  return [];
}

export async function updateMemberPride(
  memberIdentifier: string,
  identities: string[],
): Promise<boolean> {
  const memberPride = await getMemberPride();
  memberPride[memberIdentifier] = identities;
  await saveMemberPride(memberPride);
  return true;
}

export async function addMemberPride(
  memberIdentifier: string,
  identity: string,
): Promise<boolean> {
  const memberPride = await getMemberPride();
  if (!(memberIdentifier in memberPride)) memberPride[memberIdentifier] = [];
  if (!memberPride[memberIdentifier].includes(identity)) {
    memberPride[memberIdentifier].push(identity);
    await saveMemberPride(memberPride);
    return true;
  }
  return false;
}

export async function removeMemberPride(
  memberIdentifier: string,
  identity: string,
): Promise<boolean> {
  const memberPride = await getMemberPride();
  const identities = memberPride[memberIdentifier];
  if (identities && identities.includes(identity)) {
    memberPride[memberIdentifier] = identities.filter((one) => one !== identity);
    await saveMemberPride(memberPride);
    return true;
  }
  return false;
}

export async function enrichMembersWithPride(members: PKObject[]): Promise<PKObject[]> {
  const enriched: PKObject[] = [];
  for (const member of members) {
    const pride = await getMemberPrideById(member.id ?? "", member.name ?? "");
    enriched.push({ ...member, pride });
  }
  return enriched;
}
