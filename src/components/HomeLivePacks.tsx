import React, { useEffect, useState } from 'react';
import LivePacksSection from './LivePacksSection';
import { fetchWithCache } from '../lib/apiCache';
import type { LivePack } from '../types';

export default function HomeLivePacks(props: { title?: string; subtitle?: string; textColor?: string }) {
  const [packs, setPacks] = useState<LivePack[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetchWithCache('/api/live-packs').then(data => {
      if (active) setPacks(data?.success && data.enabled && Array.isArray(data.packs) ? data.packs : []);
    }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (loading) return <div className="min-h-[300px] animate-pulse bg-background-soft" />;
  return <LivePacksSection {...props} packs={packs} />;
}
