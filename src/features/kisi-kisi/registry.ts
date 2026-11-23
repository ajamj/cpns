// Kisi-Kisi Registry - Static topic data with lookup functions
import type { KisiKisiTopic } from '../../shared/types';

let kisiKisiCache: KisiKisiTopic[] = [];
let defaultWeightsCache: Record<string, number> = {};
let loadPromise: Promise<{ topics: KisiKisiTopic[]; defaultWeights: Record<string, number> }> | null = null;

export async function loadKisiKisi(): Promise<{ topics: KisiKisiTopic[]; defaultWeights: Record<string, number> }> {
  if (loadPromise) return loadPromise;
  
  loadPromise = (async () => {
    if (kisiKisiCache.length > 0 && Object.keys(defaultWeightsCache).length > 0) {
      return { topics: kisiKisiCache, defaultWeights: defaultWeightsCache };
    }
    
    try {
      const response = await fetch('/kisi-kisi.json');
      if (!response.ok) throw new Error('Failed to load kisi-kisi.json');
      const data = await response.json();
      
      const topics = data.categories.flatMap((cat: any) => 
        cat.topics.map((t: any) => ({
          ...t,
          category: cat.id,
        }))
      ) as KisiKisiTopic[];
      
      kisiKisiCache = topics;
      defaultWeightsCache = data.defaultWeights || {};
      
      return { topics, defaultWeights: defaultWeightsCache };
    } catch (error) {
      console.error('Failed to load kisi-kisi:', error);
      return { topics: [], defaultWeights: {} };
    }
  })();
  
  return loadPromise;
}

export function getKisiKisiSync(): KisiKisiTopic[] {
  return kisiKisiCache;
}

export function getDefaultWeightsSync(): Record<string, number> {
  return defaultWeightsCache;
}

export function isLoaded(): boolean {
  return kisiKisiCache.length > 0 && Object.keys(defaultWeightsCache).length > 0;
}

export function getTopicByCode(code: string): KisiKisiTopic | undefined {
  return kisiKisiCache.find(t => t.code === code);
}

export function getTopicsByCategory(category: 'umum' | 'khusus'): KisiKisiTopic[] {
  return kisiKisiCache.filter(t => t.category === category);
}

export function getTopicsBySubdomain(subdomain: KisiKisiTopic['subdomain']): KisiKisiTopic[] {
  return kisiKisiCache.filter(t => t.subdomain === subdomain);
}

export function getAllTopicCodes(): string[] {
  return kisiKisiCache.map(t => t.code);
}

export function validateTopicCode(code: string): boolean {
  return kisiKisiCache.some(t => t.code === code);
}

export function getTopicWeight(code: string, userWeights?: Record<string, number>): number {
  return userWeights?.[code] ?? defaultWeightsCache[code] ?? 1;
}

/**
 * Colour tokens for topic badges. They are themed CSS variables so the same
 * colour stays AA-legible on its 12% tint in both light and dark themes.
 */
export function getSubdomainColor(codeOrSubdomain: string): string {
  const colors: Record<string, string> = {
    meteorology: 'var(--subdomain-meteorology)',
    climatology: 'var(--subdomain-climatology)',
    geophysics: 'var(--subdomain-geophysics)',
    geology: 'var(--subdomain-geology)',
    instrumentation: 'var(--subdomain-instrumentation)',
  };

  // Callers pass topic codes (e.g. `UM-04`); resolve them through the loaded
  // kisi-kisi data when available, with a prefix fallback before load.
  const subdomain =
    getTopicByCode(codeOrSubdomain)?.subdomain ??
    (codeOrSubdomain.startsWith('UM-')
      ? 'meteorology'
      : codeOrSubdomain.startsWith('KH-')
        ? 'climatology'
        : codeOrSubdomain);

  return colors[subdomain] ?? 'var(--subdomain-default)';
}

export function getCategoryLabel(category: 'umum' | 'khusus'): string {
  return category === 'umum' ? 'Kemampuan Umum' : 'Kemampuan Khusus';
}

export function getDifficultyLabel(difficulty: 1 | 2 | 3): string {
  const labels = { 1: 'Mudah', 2: 'Sedang', 3: 'Sulit' };
  return labels[difficulty];
}

export function getMasteryLabel(level: 0 | 1 | 2 | 3): string {
  const labels = { 0: 'Baru', 1: 'Belajar', 2: 'Ulang', 3: 'Mahir' };
  return labels[level];
}

export function getMasteryColor(level: 0 | 1 | 2 | 3): string {
  const colors = {
    0: '#94a3b8', // slate-400
    1: '#fbbf24', // amber-400
    2: '#60a5fa', // blue-400
    3: '#34d399', // emerald-400
  };
  return colors[level];
}