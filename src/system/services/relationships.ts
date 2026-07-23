/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import { rt } from "../runtime";

export interface Relationship {
  id: string;
  members: [string, string];
  type: string;
  since: string | null;
}

export interface RelationshipInput {
  memberA: string;
  memberB: string;
  type?: string;
  since?: string | null;
}

const KEY = "member_relationships";

const DEFAULT_RELATIONSHIPS: Relationship[] = [];

export async function getRelationships(): Promise<Relationship[]> {
  const stored = await rt().store.get<Relationship[] | null>(KEY, null);
  if (!stored) {
    await saveRelationships(DEFAULT_RELATIONSHIPS);
    return [...DEFAULT_RELATIONSHIPS];
  }
  return stored;
}

export async function saveRelationships(relationships: Relationship[]): Promise<void> {
  await rt().store.put(KEY, relationships);
}

export async function addRelationship(input: RelationshipInput): Promise<Relationship> {
  const relationships = await getRelationships();

  const alreadyLinked = relationships.some(
    (edge) =>
      (edge.members[0] === input.memberA && edge.members[1] === input.memberB) ||
      (edge.members[0] === input.memberB && edge.members[1] === input.memberA),
  );
  if (alreadyLinked) {
    throw new Error("These members are already linked");
  }

  const relationship: Relationship = {
    id: crypto.randomUUID(),
    members: [input.memberA, input.memberB],
    type: input.type ?? "partner",
    since: input.since ?? null,
  };

  relationships.push(relationship);
  await saveRelationships(relationships);
  return relationship;
}

export async function removeRelationship(id: string): Promise<boolean> {
  const relationships = await getRelationships();
  const next = relationships.filter((edge) => edge.id !== id);
  if (next.length === relationships.length) return false;
  await saveRelationships(next);
  return true;
}
