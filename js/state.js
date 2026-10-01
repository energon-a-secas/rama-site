import { createStore } from './neorgon-persist.js';

const preferences = createStore({ key: 'rama-site:preferences', version: 1 });

export const state = {
  data: null, // Runtime data, never implicitly serialized.
  preferences: {},
};

export function loadSaved(s) {
  const saved = preferences.load({});
  // Validate each field when adding a preference. Never Object.assign saved
  // JSON onto runtime state: caches, credentials and requests do not belong here.
  s.preferences = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

/** false means this session works, but the preference could not be saved. */
export function save(s) {
  return preferences.save(s.preferences);
}
