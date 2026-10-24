import { describe, expect, it } from 'vitest';
import { CameraMode, audioPan, forwardYaw, isLookMode, listenerPan, rotateMove } from '../src';

describe('camera helpers', () => {
  it('top-down keeps raw WASD and screen-x pan', () => {
    const yaw = forwardYaw(CameraMode.TOP_DOWN, 1.23);
    for (const [mx, my] of [[1, 0], [0, -1], [-1, 1], [0, 0]]) expect(rotateMove(mx, my, yaw)).toEqual({ mx, my });
    expect(listenerPan(6, 4, yaw)).toBe(audioPan(6));
  });

  it('isometric W walks toward the -x/-y corner', () => {
    const v = rotateMove(0, -1, forwardYaw(CameraMode.ISOMETRIC, 0));
    expect(v.mx).toBeCloseTo(-Math.SQRT1_2);
    expect(v.my).toBeCloseTo(-Math.SQRT1_2);
  });

  it('look modes move and pan relative to the view yaw', () => {
    expect(isLookMode(CameraMode.THIRD_PERSON) && isLookMode(CameraMode.FIRST_PERSON)).toBe(true);
    expect(isLookMode(CameraMode.TOP_DOWN) || isLookMode(CameraMode.ISOMETRIC)).toBe(false);
    const yaw = forwardYaw(CameraMode.FIRST_PERSON, Math.PI / 2); // facing +y (screen down)
    const fwd = rotateMove(0, -1, yaw);
    expect(fwd.mx).toBeCloseTo(0);
    expect(fwd.my).toBeCloseTo(1);
    const right = rotateMove(1, 0, yaw); // right of +y in a y-down world is -x
    expect(right.mx).toBeCloseTo(-1);
    expect(right.my).toBeCloseTo(0);
    expect(listenerPan(-6, 0, yaw)).toBeCloseTo(0.5);
    expect(listenerPan(0, 6, yaw)).toBeCloseTo(0);
  });
});
