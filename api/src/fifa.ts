import { config } from './config';

// Single typed upstream client for the FIFA Plus CMS + the three normalizers.
// Everything else in the API goes through here.

export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

async function get(path: string, locale = config.locale): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${config.fifaBase}/${path}${sep}locale=${encodeURIComponent(locale)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new UpstreamError(res.status, `FIFA upstream ${res.status} for ${path}`);
  return res.json();
}

// ---------- video details (cacheable metadata) ----------

export type VideoDetails = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  releaseDate: string | null;
  lastEdited: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  tournament: string | null;
};

function tournamentFrom(raw: any): string | null {
  const tags = Array.isArray(raw?.semanticTags) ? raw.semanticTags : [];
  const hit = tags.find((t: any) => /tournament|competition/i.test(`${t?.sourceCategory ?? ''} ${t?.source ?? ''}`));
  return hit?.title ?? raw?.tournamentLogo?.title ?? null;
}

export function normalizeDetails(raw: any): VideoDetails {
  return {
    id: raw?.videoEntryId ?? raw?.id ?? '',
    title: raw?.title ?? '',
    description: raw?.description ?? '',
    durationSeconds: raw?.duration ?? null,
    releaseDate: raw?.dateOfRelease ?? null,
    lastEdited: raw?.dateOfLastEdit ?? null,
    category: raw?.videoCategory ?? null,
    subcategory: raw?.videoSubcategory ?? null,
    tags: Array.isArray(raw?.semanticTags) ? raw.semanticTags.map((t: any) => t?.title).filter(Boolean) : [],
    tournament: tournamentFrom(raw),
  };
}

export async function getDetails(id: string, locale?: string): Promise<VideoDetails> {
  return normalizeDetails(await get(`sections/videoDetails/${id}`, locale));
}

// Lightweight per-video metadata used to enrich the catalog (duration + thumbnail).
export async function getCatalogMeta(id: string, locale?: string): Promise<{ durationSeconds: number | null; thumbnail: string | null }> {
  const raw = await get(`sections/videoDetails/${id}`, locale);
  return {
    durationSeconds: raw?.duration ?? null,
    thumbnail: raw?.backgroundImage?.src ?? raw?.tournamentLogo?.src ?? null,
  };
}

// ---------- playback (short-lived, never cached) ----------

export function buildStreamUrl(assetGuid: string, preplay: { queryStr: string; signature: string }): string {
  // Uplynk Preplay v2 JSON endpoint. The signature signs queryStr and is appended as &sig=.
  // The browser fetches this JSON to get the actual playURL (.m3u8). No iph param => not IP-bound.
  return `https://content.uplynk.com/preplay/${assetGuid}.json?${preplay.queryStr}&sig=${preplay.signature}`;
}

export type Playback = ReturnType<typeof normalizePlayback>;

export function normalizePlayback(raw: any) {
  const p = raw?.preplayParameters ?? {};
  const guid: string = raw?.verizonAssetGuid ?? '';
  const img = raw?.videoPosterImage ?? {};
  const expSec = Number(p?.tokenExpirationDate);
  return {
    videoType: raw?.videoType ?? null,
    title: raw?.title ?? '',
    description: raw?.description ?? '',
    poster: { src: img?.src ?? null, alt: img?.alt ?? null, width: img?.width ?? null, height: img?.height ?? null },
    uplynk: { externalAssetId: raw?.externalVerizonAssetId ?? null, assetGuid: guid || null },
    durationSeconds: raw?.duration ?? null,
    requiresToken: !!raw?.requiresToken,
    requiresDRM: !!raw?.requiresDRM,
    preplay: {
      contentId: p?.contentId ?? null,
      preplayAPIVersion: p?.preplayAPIVersion ?? null,
      tokenCheckAlgorithmVersion: p?.tokenCheckAlgorithmVersion ?? null,
      contentType: p?.contentType ?? null,
      randomNumber: p?.randomNumber ?? null,
      tokenExpirationDate: p?.tokenExpirationDate ?? null,
      signature: p?.signature ?? null,
      queryStr: p?.queryStr ?? null,
      disallowedCountryCodes: p?.disallowedCountryCodes ?? '',
    },
    ads: {
      configuration: p?.adConfiguration ?? null,
      preroll: !!p?.adPreroll,
      postroll: !!p?.adPostroll,
      cmsSourceId: p?.adCMSSourceId ?? null,
      sourceVideoId: p?.adSourceVideoID ?? null,
      customParameters: p?.customAdParameters ?? null,
      nonPersonalized: p?.nonPersonalizedAdverts ?? null,
      allowClientSideParameters: p?.allowClientSideAdParameters ?? null,
      parameterExpansion: p?.parameterExpansion ?? null,
    },
    streamUrl: guid && p?.queryStr && p?.signature ? buildStreamUrl(guid, p) : null,
    tokenExpiration: Number.isFinite(expSec) ? new Date(expSec * 1000).toISOString() : null,
  };
}

export async function getPlayback(id: string, locale?: string) {
  return normalizePlayback(await get(`videoPlayerData/${id}`, locale));
}
