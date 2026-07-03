import { supabase } from './supabase';

export const API_BASE = process.env.EXPO_PUBLIC_API_URL;

export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}
