/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

import type { Hono } from "hono";
import type { User } from "./models";

/** Variables carried on the Hono context (set by auth middleware). */
export type Variables = {
  user?: User;
};

export type Env = { Variables: Variables };
export type App = Hono<Env>;
