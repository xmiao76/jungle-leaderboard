// POST /api/catalog — publish one tested entrant. See server/catalog-upload.ts.
import { handleCatalogUpload, type CatalogUploadEnv } from '../../../server/catalog-upload';

export const onRequestPost: PagesFunction<CatalogUploadEnv> = ({ env, request }) => handleCatalogUpload(env, request);
