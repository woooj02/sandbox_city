import { Shader, Texture, type Filter } from 'pixi.js';

/** Detach filter bindings before their owned or pooled textures are destroyed. */
export function releaseFilter(filter: Filter) {
  for (const group of new Set(Object.values(filter.groups))) {
    for (const [index, resource] of Object.entries(group.resources)) {
      if (resource?._resourceType === 'textureSource') group.setResource(Texture.EMPTY.source, Number(index));
      if (resource?._resourceType === 'textureSampler') group.setResource(Texture.EMPTY.source.style, Number(index));
    }
  }
  filter.destroy();
  // GlitchFilter 6 disposes its texture but omits the base shader cleanup.
  // Keep the cached programs: other cities may still use them.
  Shader.prototype.destroy.call(filter);
}
