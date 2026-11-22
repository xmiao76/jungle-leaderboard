// GET/HEAD /api/catalog/manifest.json and /api/catalog/<sha256>.wasm — see server/catalog-read.ts.
import { handleCatalogGet, handleCatalogHead } from '../../../server/catalog-read';

export const onRequestGet: PagesFunction<Env, 'file'> = ({ env, params }) => handleCatalogGet(env, String(params.file));
export const onRequestHead: PagesFunction<Env, 'file'> = ({ env, params }) => handleCatalogHead(env, String(params.file));
