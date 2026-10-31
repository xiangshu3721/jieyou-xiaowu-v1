import { describe, expect, it } from 'vitest';
import { appRouteKey, readAppRoute, type AppLocation } from './router.js';

function locationLike(value: Partial<Location>): AppLocation {
  return {
    pathname: value.pathname || '/',
    search: value.search || '',
    hash: value.hash || '',
  };
}

describe('app route resolution', () => {
  it('reads a hash route after a Pages subpath', () => {
    expect(readAppRoute(locationLike({ pathname: '/v19-staging/', hash: '#/chat' }), '/v19-staging/')).toEqual({
      path: '/chat',
      search: '',
    });
  });

  it('keeps booking result query parameters in the hash route', () => {
    expect(readAppRoute(locationLike({ pathname: '/jieyou-xiaowu-v1/', hash: '#/booking/result?requestId=JY-test-001' }), '/jieyou-xiaowu-v1/')).toEqual({
      path: '/booking/result',
      search: '?requestId=JY-test-001',
    });
  });

  it('resolves the repository root without a hash to home', () => {
    expect(readAppRoute(locationLike({ pathname: '/jieyou-xiaowu-v1/' }), '/jieyou-xiaowu-v1/')).toEqual({
      path: '/',
      search: '',
    });
  });

  it('changes the route key when the hash changes', () => {
    const home = appRouteKey(locationLike({ pathname: '/v19-staging/', hash: '#/' }));
    const chat = appRouteKey(locationLike({ pathname: '/v19-staging/', hash: '#/chat' }));
    expect(home).not.toBe(chat);
  });
});
