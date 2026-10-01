/* Browser-local preferences; also exported for storage regression tests. */
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MCSAPreferences = factory();
})(typeof globalThis === 'object' ? globalThis : this, () => {
  'use strict';
  const keys = Object.freeze({
    choice: 'mcsa-privacy-choice', preferences: 'mcsa-preferences',
    language: 'mcsa-language', session: 'mcsa-session-preferences', intro: 'mcsa-intro-seen'
  });
  const defaults = () => ({ remember: false, intro: true, motion: true, language: 'zh', choice: null });
  const language = value => value === 'yue' ? 'hant' : ['zh', 'en', 'hant'].includes(value) ? value : 'zh';
  const valid = value => value && typeof value === 'object' && !Array.isArray(value)
    && ['remember', 'intro', 'motion'].every(key => typeof value[key] === 'boolean');

  function create(storage = { local: () => window.localStorage, session: () => window.sessionStorage }) {
    let state = defaults(), seen = false;
    function access(area, method, key, value) {
      try { return { ok: true, value: storage[area]()[method](key, value) }; }
      catch { return { ok: false, value: null }; }
    }
    function read(area, key) { return access(area, 'getItem', key); }
    function parse(value) { try { return JSON.parse(value); } catch { return null; } }
    function refresh() {
      const decision = read('local', keys.choice);
      const saved = read('local', keys.preferences);
      const temporary = read('session', keys.session);
      // Preserve the current in-memory choice when both storage areas are blocked.
      if (!decision.ok && !temporary.ok) return snapshot();
      const persistent = parse(saved.value), session = parse(temporary.value);
      const choice = ['allowed', 'denied'].includes(decision.value) ? decision.value
        : valid(persistent) ? (persistent.remember ? 'allowed' : 'denied') : null;
      state = defaults();
      state.choice = choice;
      if (choice === 'allowed') {
        if (valid(persistent)) Object.assign(state, { intro: persistent.intro, motion: persistent.motion });
        state.remember = true;
        state.language = language(read('local', keys.language).value);
      } else if (valid(session) && [null, 'allowed', 'denied'].includes(session.choice)
        && (choice === null || session.choice === choice)) {
        Object.assign(state, session, { language: language(session.language), choice: choice || session.choice });
        state.remember = state.choice === 'allowed';
      }
      const playback = read('session', keys.intro);
      if (playback.ok) seen = playback.value === '1';
      return snapshot();
    }
    function snapshot() { return Object.freeze({ ...state }); }
    function persist() {
      const operations = [];
      if (state.choice === 'allowed') {
        operations.push(access('local', 'setItem', keys.preferences, JSON.stringify({
          remember: true, intro: state.intro, motion: state.motion
        })));
        operations.push(access('local', 'setItem', keys.language, state.language));
        operations.push(access('local', 'setItem', keys.choice, 'allowed'));
      } else if (state.choice === 'denied') {
        operations.push(access('local', 'removeItem', keys.preferences));
        operations.push(access('local', 'removeItem', keys.language));
        operations.push(access('local', 'setItem', keys.choice, 'denied'));
      }
      const persistent = operations.length > 0 && operations.every(result => result.ok);
      if (state.choice === 'denied' && !persistent) access('local', 'removeItem', keys.choice);
      if (state.choice === 'allowed' && !persistent) {
        // Do not leave a partial grant behind after a quota/storage failure.
        [keys.preferences, keys.language, keys.choice].forEach(key => access('local', 'removeItem', key));
      }
      const session = state.choice === 'allowed' && persistent
        ? access('session', 'removeItem', keys.session).ok
        : access('session', 'setItem', keys.session, JSON.stringify(state)).ok;
      return { persistent, session };
    }
    function save(preferences, selectedLanguage = state.language) {
      if (!valid(preferences)) throw new TypeError('Invalid preferences');
      state = { ...preferences, language: language(selectedLanguage), choice: preferences.remember ? 'allowed' : 'denied' };
      return persist();
    }
    function setLanguage(value) {
      state.language = language(value);
      return persist();
    }
    function clear() {
      const removed = [keys.choice, keys.preferences, keys.language].map(key => access('local', 'removeItem', key));
      removed.push(...[keys.session, keys.intro].map(key => access('session', 'removeItem', key)));
      state = defaults();
      seen = false;
      return removed.every(result => result.ok);
    }
    refresh();
    return Object.freeze({
      get value() { return snapshot(); }, refresh, save, setLanguage, clear,
      get introSeen() { return seen; },
      markIntroSeen() { seen = true; return access('session', 'setItem', keys.intro, '1').ok; }
    });
  }
  return Object.freeze({ create, keys });
});
