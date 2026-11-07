import { afterEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ finish: () => {}, destroy: vi.fn(), stop: vi.fn(), textures: vi.fn() }));
vi.mock('pixi.js', () => {
  class Container { addChild = vi.fn(); }
  return { Container, Graphics: Container, Text: Container, TextStyle: Container, Sprite: Container, Texture: {}, Shader: class {},
    Application: class {
      stage = new Container(); canvas = {}; destroy = lifecycle.destroy; stop = lifecycle.stop;
      init() { return new Promise<void>((resolve) => { lifecycle.finish = resolve; }); }
    },
  };
});
vi.mock('pixi-filters', () => ({ AdvancedBloomFilter: class {}, ShockwaveFilter: class {}, GlitchFilter: class {} }));
vi.mock('../src/city/textures', () => ({ makeTextures: lifecycle.textures }));
import { CityRenderer } from '../src/city/CityRenderer';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('navigation during asynchronous city setup', () => {
  it('releases a late renderer once without attaching a canvas or purging shared resources', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const host = { clientWidth: 1000, clientHeight: 700, appendChild: vi.fn() };
    const renderer = new CityRenderer(host as unknown as HTMLElement, { lane: 0, xray: () => false });
    const pending = renderer.init();
    renderer.destroy(); renderer.destroy();
    expect(lifecycle.destroy).not.toHaveBeenCalled();
    lifecycle.finish();
    await pending;
    renderer.destroy();
    expect(host.appendChild).not.toHaveBeenCalled();
    expect(lifecycle.textures).not.toHaveBeenCalled();
    expect(lifecycle.stop).toHaveBeenCalledOnce();
    expect(lifecycle.destroy).toHaveBeenCalledExactlyOnceWith({ removeView: true, releaseGlobalResources: false }, { children: true });
  });
});
