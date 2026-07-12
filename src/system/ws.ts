/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * Broadcast helpers. The old backend had a ConnectionManager holding a Set
 * of `ws` sockets; here the sockets live on the SystemState DO (hibernatable
 * WebSockets) and `rt().broadcast` fans a payload out to all of them.
 */

import { rt } from "./runtime";

export function broadcastFrontingUpdate(frontersData: unknown): void {
  rt().broadcast({ type: "fronters_update", data: frontersData });
}

export function broadcastMentalStateUpdate(stateData: unknown): void {
  rt().broadcast({ type: "mental_state_update", data: stateData });
}

export function broadcastFrontendUpdate(updateType: string, data: unknown): void {
  rt().broadcast({ type: updateType, data });
}
