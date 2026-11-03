import { IS_REMOTE } from '../config.js';
import { createLocalStore } from './local.js';

export async function createStore() {
  if (IS_REMOTE) {
    const { createSupabaseStore } = await import('./supabase.js');
    return createSupabaseStore();
  }
  return createLocalStore();
}
