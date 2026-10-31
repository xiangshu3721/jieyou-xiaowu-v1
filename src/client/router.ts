export type AppLocation = Pick<Location, 'hash' | 'pathname' | 'search'>;

export type AppRoute = {
  path: string;
  search: string;
};

export function readAppRoute(currentLocation: AppLocation, baseUrl: string): AppRoute {
  const hashRoute = currentLocation.hash.startsWith('#/') ? currentLocation.hash.slice(1) : '';
  const rawRoute = hashRoute || currentLocation.pathname;
  const queryIndex = rawRoute.indexOf('?');
  const rawPath = queryIndex >= 0 ? rawRoute.slice(0, queryIndex) : rawRoute;
  const hashSearch = queryIndex >= 0 ? rawRoute.slice(queryIndex) : '';
  const normalizedBase = baseUrl === '/' ? '/' : baseUrl.replace(/\/$/, '');
  const path = normalizedBase !== '/' && rawPath.startsWith(normalizedBase)
    ? rawPath.slice(normalizedBase.length) || '/'
    : rawPath || '/';

  return {
    path: path.startsWith('/') ? path : `/${path}`,
    search: hashRoute ? hashSearch : currentLocation.search,
  };
}

export function appRouteKey(currentLocation: AppLocation) {
  return `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`;
}
