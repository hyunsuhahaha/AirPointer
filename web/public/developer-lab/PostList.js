export function renderPosts(response, guarded = false) {
  const items = guarded ? response.items ?? [] : response.items;
  return items.map(title => title);
}
