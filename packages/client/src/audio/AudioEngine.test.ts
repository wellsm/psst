import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RECORDED } from './AudioEngine';
import { CLIP_IDS, type ClipId } from './synth';

const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

describe('recorded clips', () => {
  it.each(Object.entries(RECORDED))('%s points at a shipped file', (id, url) => {
    expect(CLIP_IDS).toContain(id as ClipId);
    expect(existsSync(PUBLIC_DIR + url)).toBe(true);
  });
});
