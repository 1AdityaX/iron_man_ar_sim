import { ARC_REACTOR } from './arcReactor';
import { GLOBE } from './globe';
import type { ObjectSpec } from './holoObject';
import { THRUSTER } from './thruster';

/** Everything the SPAWN OBJECT menu can create. */
export const CATALOG: readonly ObjectSpec[] = [ARC_REACTOR, THRUSTER, GLOBE];

export function specByKind(kind: string): ObjectSpec | undefined {
  return CATALOG.find((s) => s.kind === kind);
}
