import { describe, expect, it, vi } from 'vitest';
import { Filter, TextureSource } from 'pixi.js';
import { releaseFilter } from '../src/city/releaseFilter';

describe('filter texture ownership', () => {
  it('detaches source and sampler bindings before a filter destroys its texture', () => {
    const source = new TextureSource({ width: 4, height: 4 });
    const filter = new Filter({ resources: { texture: source, sampler: source.style } });
    // The installed GlitchFilter destroys its texture without calling Shader.destroy.
    filter.destroy = () => { source.destroy(); };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      releaseFilter(filter);
      expect(source.destroyed).toBe(true);
      expect(filter.groups).toBeNull();
      expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
});
