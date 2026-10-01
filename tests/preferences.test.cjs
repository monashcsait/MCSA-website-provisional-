const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, keys } = require('../assets/preferences.js');

function memory(initial = {}, blocked = false) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { if (blocked) throw Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error('blocked'); values.set(key, String(value)); },
    removeItem(key) { if (blocked) throw Error('blocked'); values.delete(key); }
  };
}
const storage = (local, session) => ({ local: () => local, session: () => session });
const choices = { remember: true, intro: false, motion: false };

test('undecided visits never write long-term preferences', () => {
  const local = memory(), session = memory(), store = create(storage(local, session));
  assert.equal(store.value.choice, null);
  assert.equal(store.value.remember, false);
  store.setLanguage('en');
  store.markIntroSeen();
  assert.equal(local.values.size, 0);
  assert.equal(create(storage(local, session)).value.language, 'en');
  assert.equal(create(storage(local, session)).introSeen, true);
});

test('allow restores all preferences across sessions and saves current language', () => {
  const local = memory(), session = memory(), store = create(storage(local, session));
  assert.deepEqual(store.save(choices, 'en'), { persistent: true, session: true });
  const restored = create(storage(local, memory()));
  assert.deepEqual(restored.value, { ...choices, language: 'en', choice: 'allowed' });
  assert.equal(local.getItem(keys.choice), 'allowed');
  assert.equal(Object.isFrozen(restored.value), true);
});

test('deny retains only the decision long-term, and display choices for the tab session', () => {
  const local = memory(), session = memory(), store = create(storage(local, session));
  store.save(choices, 'en');
  store.markIntroSeen();
  store.save({ ...choices, remember: false }, 'hant');
  assert.deepEqual([...local.values], [[keys.choice, 'denied']]);
  assert.deepEqual(create(storage(local, session)).value, {
    remember: false, intro: false, motion: false, language: 'hant', choice: 'denied'
  });
  assert.equal(create(storage(local, session)).introSeen, true);
  assert.deepEqual(create(storage(local, memory())).value, {
    remember: false, intro: true, motion: true, language: 'zh', choice: 'denied'
  });
});

test('re-enabling storage uses current temporary choices', () => {
  const local = memory(), session = memory(), store = create(storage(local, session));
  store.save({ ...choices, remember: false }, 'en');
  const nextPage = create(storage(local, session));
  nextPage.save({ ...nextPage.value, remember: true });
  assert.equal(session.getItem(keys.session), null);
  assert.deepEqual(create(storage(local, memory())).value, { ...choices, language: 'en', choice: 'allowed' });
});

test('clear resets the page and removes only public MCSA records', () => {
  const local = memory({ unrelated: 'keep' }), session = memory({ 'admin-other': 'keep' });
  const store = create(storage(local, session));
  store.save(choices, 'en');
  store.markIntroSeen();
  assert.equal(store.clear(), true);
  assert.deepEqual([...local.values], [['unrelated', 'keep']]);
  assert.deepEqual([...session.values], [['admin-other', 'keep']]);
  assert.equal(store.value.choice, null);
  assert.equal(store.introSeen, false);
});

test('valid legacy choices restore without prompting; unsupported values are ignored', () => {
  const local = memory({ [keys.preferences]: JSON.stringify(choices), [keys.language]: 'yue' });
  const store = create(storage(local, memory()));
  assert.equal(store.value.choice, 'allowed');
  assert.equal(store.value.language, 'hant');
  for (const value of ['broken', 'null', '[]', '{"remember":true,"motion":"false"}', '{"remember":true}']) {
    assert.equal(create(storage(memory({ [keys.preferences]: value }), memory())).value.choice, null);
  }
});

test('an explicit denial overrides lingering old persistent preferences', () => {
  const local = memory({ [keys.choice]: 'denied', [keys.preferences]: JSON.stringify(choices), [keys.language]: 'en' });
  assert.deepEqual(create(storage(local, memory())).value, {
    remember: false, intro: true, motion: true, language: 'zh', choice: 'denied'
  });
});

test('blocked long-term storage falls back to the session with an accurate result', () => {
  const local = memory({}, true), session = memory(), store = create(storage(local, session));
  assert.deepEqual(store.save(choices, 'en'), { persistent: false, session: true });
  assert.deepEqual(create(storage(local, session)).value, { ...choices, language: 'en', choice: 'allowed' });
});

test('blocked storage retains the current page choice and reports clear failure', () => {
  const store = create(storage(memory({}, true), memory({}, true)));
  assert.deepEqual(store.save(choices, 'en'), { persistent: false, session: false });
  assert.equal(store.refresh().choice, 'allowed');
  assert.equal(store.clear(), false);
  assert.equal(store.value.choice, null);
});

test('quota failure does not leave a partial allowance in persistent storage', () => {
  const local = memory(), session = memory();
  local.setItem = (key, value) => { if (key === keys.language) throw Error('quota'); local.values.set(key, value); };
  const store = create(storage(local, session));
  assert.equal(store.save(choices, 'en').persistent, false);
  assert.equal(local.values.size, 0);
  assert.equal(create(storage(local, session)).value.choice, 'allowed');
});

test('refresh reflects clearing the intro record from another page', () => {
  const local = memory(), session = memory(), store = create(storage(local, session));
  store.markIntroSeen();
  create(storage(local, session)).clear();
  store.refresh();
  assert.equal(store.introSeen, false);
});

test('a failed denial write does not restore an old allowance on navigation', () => {
  const local = memory(), session = memory(), store = create(storage(local, session));
  store.save(choices, 'en');
  local.setItem = () => { throw Error('quota'); };
  assert.equal(store.save({ ...choices, remember: false }, 'hant').persistent, false);
  assert.equal(create(storage(local, session)).value.choice, 'denied');
});
