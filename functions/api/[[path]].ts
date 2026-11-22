// Any other /api/ path or method is a 404, never the site's HTML fallback. More specific routes
// (functions/api/catalog/) take precedence over this catch-all.
export const onRequest: PagesFunction = () => new Response('Not found', { status: 404 });
