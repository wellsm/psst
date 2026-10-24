import { audioPan } from './sound';

/** `MatchSettings.cameraMode` values (host rule, same view for everyone). The rule only offers ISOMETRIC and THIRD_PERSON. */
export const CameraMode = {
  TOP_DOWN: 0,
  ISOMETRIC: 1,
  THIRD_PERSON: 2,
  FIRST_PERSON: 3,
} as const;

/** Modes where the view turns with the player's head (mouse-look). */
export const isLookMode = (mode: number) => mode === CameraMode.THIRD_PERSON || mode === CameraMode.FIRST_PERSON;

/**
 * World angle (atan2 convention, y down) that "forward" (W / screen up) points to.
 * `lookYaw` is the player's view yaw, used only by the mouse-look modes.
 */
export function forwardYaw(mode: number, lookYaw: number): number {
  if (isLookMode(mode)) return lookYaw;
  if (mode === CameraMode.ISOMETRIC) return (-3 * Math.PI) / 4;
  return -Math.PI / 2;
}

/** Screen-relative move input (mx right, my down) → world move vector for a view facing `yaw`. */
export function rotateMove(mx: number, my: number, yaw: number): { mx: number; my: number } {
  const fx = Math.cos(yaw), fy = Math.sin(yaw);
  // Right of forward, in the y-down world.
  const rx = -fy, ry = fx;
  const x = rx * mx - fx * my;
  const y = ry * mx - fy * my;
  // Snap float noise so the top-down view stays bit-identical to raw input.
  return { mx: Math.round(x * 1e9) / 1e9, my: Math.round(y * 1e9) / 1e9 };
}

/** Stereo pan of a sound at (dx, dy) from the listener, along the right axis of a view facing `yaw`. */
export function listenerPan(dx: number, dy: number, yaw: number): number {
  return audioPan(Math.round((-Math.sin(yaw) * dx + Math.cos(yaw) * dy) * 1e9) / 1e9);
}
