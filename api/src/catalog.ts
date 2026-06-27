import { getCatalogMeta } from './fifa';

// Static seed of all 2026 World Cup highlights, grouped. The promoCarousel IDs are not
// discoverable from FIFA's CSR pages, so the catalog is config-driven here. Groups G/K/L
// have 4 matches now and will grow — add rows as more matchdays complete.
export type SeedMatch = { group: string; home: string; away: string; videoId: string };

export const SEED: SeedMatch[] = [
  // Group A
  { group: 'A', home: 'South Africa', away: 'Korea Republic', videoId: '4rg8eRpXuMQG67utITccQd' },
  { group: 'A', home: 'Czechia', away: 'Mexico', videoId: '2GE7VJlgfD52khnWAjGpF2' },
  { group: 'A', home: 'Mexico', away: 'Korea Republic', videoId: '7EONkqbttoSK2UPpHkR6oz' },
  { group: 'A', home: 'Czechia', away: 'South Africa', videoId: '8zfEoeCcUxu8wn5usWw5U' },
  { group: 'A', home: 'Korea Republic', away: 'Czechia', videoId: '1iidGe97khg8lmdSRopdh4' },
  { group: 'A', home: 'Mexico', away: 'South Africa', videoId: '7wv3jFr0T2wczSuQbhgrSW' },
  // Group B
  { group: 'B', home: 'Bosnia and Herzegovina', away: 'Qatar', videoId: '5CVV8X8QSnZDr6uKOh31ff' },
  { group: 'B', home: 'Switzerland', away: 'Canada', videoId: '1KiU2uFEKhMDYVNebmF5Zg' },
  { group: 'B', home: 'Canada', away: 'Qatar', videoId: '2aUGsEuBEIsCLXNrzkbo4m' },
  { group: 'B', home: 'Switzerland', away: 'Bosnia and Herzegovina', videoId: '4xMCS0fOjrGIgHyv1ks6Tz' },
  { group: 'B', home: 'Qatar', away: 'Switzerland', videoId: 'NdoxOQqn5cnkmfioABvsL' },
  { group: 'B', home: 'Canada', away: 'Bosnia and Herzegovina', videoId: '5ekSKA6XJZqv9Fag9pI7sH' },
  // Group C
  { group: 'C', home: 'Morocco', away: 'Haiti', videoId: '4lDtvGJGbp8eEdlUUUZo3I' },
  { group: 'C', home: 'Scotland', away: 'Brazil', videoId: 'xuXoaffqDTNw6l4ejzMrz' },
  { group: 'C', home: 'Scotland', away: 'Morocco', videoId: 'lLPqiMKeKkrKkEqOj9dxU' },
  { group: 'C', home: 'Brazil', away: 'Haiti', videoId: '4B1cORLHftHRri3QzyPvng' },
  { group: 'C', home: 'Brazil', away: 'Morocco', videoId: '1e8ayUzYWGZDbZUEU42bgQ' },
  { group: 'C', home: 'Haiti', away: 'Scotland', videoId: '1amePIIN9Rt7kvMwQGMPke' },
  // Group D
  { group: 'D', home: 'Paraguay', away: 'Australia', videoId: '4NNX3soy5dReiHMd5HxRXA' },
  { group: 'D', home: 'Türkiye', away: 'USA', videoId: 'qE2AtDA3GeQvnPPOcQCmi' },
  { group: 'D', home: 'USA', away: 'Australia', videoId: '1uOCG5cpsR45kemo4IdCO3' },
  { group: 'D', home: 'Türkiye', away: 'Paraguay', videoId: '6gtrw3fGvuONahHQd4yE67' },
  { group: 'D', home: 'Australia', away: 'Türkiye', videoId: '6qvmyR3k0BcpuPrSmer7Mf' },
  { group: 'D', home: 'USA', away: 'Paraguay', videoId: '6jzgitUqP6YyXpwwuY6VRc' },
  // Group E
  { group: 'E', home: 'Ecuador', away: 'Germany', videoId: '6zwOi8MRCYL1qFZ0LwyOAD' },
  { group: 'E', home: 'Curaçao', away: "Côte d'Ivoire", videoId: '450gMxJHBSeV5QctbBsC9o' },
  { group: 'E', home: 'Ecuador', away: 'Curaçao', videoId: '6lI7ddpjskKW6dYr7nB7I4' },
  { group: 'E', home: 'Germany', away: "Côte d'Ivoire", videoId: '2ofHeol8LZn44A3ThxLwdE' },
  { group: 'E', home: 'Germany', away: 'Curaçao', videoId: '3MSlsbd2rcnTGlcG4jhpdR' },
  { group: 'E', home: "Côte d'Ivoire", away: 'Ecuador', videoId: '4P79SuyJHO3ZGVuRYxjots' },
  // Group F
  { group: 'F', home: 'Tunisia', away: 'Netherlands', videoId: '2YZkJfuTl6nfWtN0Afygpx' },
  { group: 'F', home: 'Japan', away: 'Sweden', videoId: '2H1Uv4cmCqxFLfQRHvO2Kq' },
  { group: 'F', home: 'Tunisia', away: 'Japan', videoId: '1nNMGQHe2Ar9v5mv1Q6drf' },
  { group: 'F', home: 'Netherlands', away: 'Sweden', videoId: 'oQAXWFfSFtgXIEhnTdrE6' },
  { group: 'F', home: 'Sweden', away: 'Tunisia', videoId: '1xJ82g9ocfLQaweWUFgFMw' },
  { group: 'F', home: 'Netherlands', away: 'Japan', videoId: 'hfEd1R54PslEMX4Rqb0EP' },
  // Group G (partial)
  { group: 'G', home: 'New Zealand', away: 'Egypt', videoId: '30AjAOgeWPeCcjnTx6hdH0' },
  { group: 'G', home: 'Belgium', away: 'IR Iran', videoId: '2eqX8tJNDvSqLjtLDPgDkT' },
  { group: 'G', home: 'Belgium', away: 'Egypt', videoId: '2XSqobMgEwKFuhEozWztJl' },
  { group: 'G', home: 'IR Iran', away: 'New Zealand', videoId: '5c6T3T7Y1XfKrT3aXzJRqL' },
  // Group H
  { group: 'H', home: 'Uruguay', away: 'Spain', videoId: '2Iw0XHRZ4pZhQeVyekPApR' },
  { group: 'H', home: 'Cabo Verde', away: 'Saudi Arabia', videoId: '6cEIYSaBZmtelEG6H679Pu' },
  { group: 'H', home: 'Spain', away: 'Saudi Arabia', videoId: '4ZigaLfUmzRMpzV7ETANXM' },
  { group: 'H', home: 'Uruguay', away: 'Cabo Verde', videoId: '4KLTlmsKLMMlM9IsPFWzj9' },
  { group: 'H', home: 'Spain', away: 'Cabo Verde', videoId: 'jLS5YXPMr0XAd5lMHtbiJ' },
  { group: 'H', home: 'Saudi Arabia', away: 'Uruguay', videoId: '2OO54UvFW7GK8vnsarneGk' },
  // Group I
  { group: 'I', home: 'Senegal', away: 'Iraq', videoId: 'maf9mo9s3FMRyykghM66d' },
  { group: 'I', home: 'Norway', away: 'France', videoId: 'THUuOCgcktTdRUWJbCDNL' },
  { group: 'I', home: 'France', away: 'Iraq', videoId: '5baxscpTWAh30KnlPk6NPK' },
  { group: 'I', home: 'Norway', away: 'Senegal', videoId: '2z83J5vynam1wsTQNemf5u' },
  { group: 'I', home: 'Iraq', away: 'Norway', videoId: 'SsQRwgoouokLgVYDKitmB' },
  { group: 'I', home: 'France', away: 'Senegal', videoId: '3EKjirmmC6D2Ss29rPdDph' },
  // Group J (partial)
  { group: 'J', home: 'Jordan', away: 'Algeria', videoId: '6MH3nU83TBWaW2rJyDG7UM' },
  { group: 'J', home: 'Argentina', away: 'Austria', videoId: '6N4dkwqyP1sUURyCXExX5s' },
  { group: 'J', home: 'Austria', away: 'Jordan', videoId: '77P4VoHiQj3RG3yEQVhGpH' },
  { group: 'J', home: 'Argentina', away: 'Algeria', videoId: '7w5eTQ8xbmnSNHypyuYhdG' },
  // Group K (partial)
  { group: 'K', home: 'Colombia', away: 'Congo DR', videoId: '26nrhBN70NStG6P9xmqto7' },
  { group: 'K', home: 'Portugal', away: 'Uzbekistan', videoId: '4se3Lqdtrvu86pMuaqlUpn' },
  { group: 'K', home: 'Uzbekistan', away: 'Colombia', videoId: '6Tr0HFdKBRPzlKF5p6kFLD' },
  { group: 'K', home: 'Portugal', away: 'Congo DR', videoId: '3phBNopGuBvaow9DPBc2D' },
  // Group L (partial)
  { group: 'L', home: 'Panama', away: 'Croatia', videoId: '5ewcE9E2gBUvXwyGfkEz1n' },
  { group: 'L', home: 'England', away: 'Ghana', videoId: 'YMV6IJCxemtC0s8HtqPn3' },
  { group: 'L', home: 'England', away: 'Croatia', videoId: '69ls3TcVt6PIJPxhiREehA' },
  { group: 'L', home: 'Ghana', away: 'Panama', videoId: '5yGWUJLlTqyvKydpUvLJnU' },
];

export type CatalogItem = {
  videoId: string;
  title: string;
  group: string;
  durationSeconds: number | null;
  thumbnail: string | null;
};

// Enrich each seed row with duration + thumbnail from videoDetails (parallel, fault-tolerant).
// ponytail: first uncached call fans out ~64 upstream requests; the whole result is then cached
// by the caller. Ceiling: precompute/persist if the seed grows large.
export async function buildCatalog(locale?: string): Promise<CatalogItem[]> {
  return Promise.all(
    SEED.map(async (m): Promise<CatalogItem> => {
      const base = { videoId: m.videoId, title: `${m.home} v ${m.away}`, group: m.group };
      try {
        const meta = await getCatalogMeta(m.videoId, locale);
        return { ...base, ...meta };
      } catch {
        return { ...base, durationSeconds: null, thumbnail: null };
      }
    }),
  );
}
