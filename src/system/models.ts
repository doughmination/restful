/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * zod models + types. Field names stay snake_case to match the existing
 * data blobs and the frontend wire format. Consolidated from the old
 * models/user.ts + models/index.ts.
 */

import { z } from "zod";

// ============================================================================
// USER MODELS
// ============================================================================

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  password_hash: z.string(),
  display_name: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_owner: z.boolean().default(false),
  is_pet: z.boolean().default(false),
  avatar_url: z.string().nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const UserCreateSchema = z.object({
  username: z.string(),
  password: z.string(),
  display_name: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_pet: z.boolean().default(false),
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

export const UserResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  display_name: z.string().nullable().optional(),
  is_admin: z.boolean().default(false),
  is_owner: z.boolean().default(false),
  is_pet: z.boolean().default(false),
  avatar_url: z.string().nullable().optional(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const UserUpdateSchema = z.object({
  display_name: z.string().nullable().optional(),
  current_password: z.string().nullable().optional(),
  new_password: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  is_admin: z.boolean().nullable().optional(),
  is_pet: z.boolean().nullable().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  turnstile_token: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Strip the password hash for public-facing responses. */
export function toUserResponse(user: User): UserResponse {
  const { password_hash: _drop, ...rest } = user;
  return rest;
}

// ============================================================================
// SYSTEM / MENTAL STATE
// ============================================================================

export const MentalStateSchema = z.object({
  level: z.string(),
  updated_at: z.coerce.date().default(() => new Date()),
  notes: z.string().nullable().optional(),
});
export type MentalState = z.infer<typeof MentalStateSchema>;

// ============================================================================
// BOT MODELS
// ============================================================================

export const MultiSwitchRequestSchema = z.object({
  member_ids: z.array(z.string()),
});
export type MultiSwitchRequest = z.infer<typeof MultiSwitchRequestSchema>;
