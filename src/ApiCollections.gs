/** Server functions for the Collections section: creating and editing lists themselves. */

var COLLECTION_ICON_DEFAULTS = {
  Yearly: '📆', Seasonal: '🎃', Curated: '🩸', Classics: '🦇', Bestiary: '👹',
  Alphabet: '🔤', Franchise: '🔪', Bubblegum: '🫧'
};

/**
 * Creates a new list inside a family (a new curated list, franchise, countdown...).
 * Bestiary categories and Classic Studios are fixed sets, so they can't be added to.
 */
function apiCreateCollection(family, name, icon, description) {
  return withWriteLock_(function () {
    name = String(name || '').trim();
    if (COLLECTION_FAMILIES.indexOf(family) < 0) throw new Error('Unknown family ' + family);
    if (family === 'Bestiary') throw new Error('The 15 Bestiary categories are locked.');
    if (family === 'Classics') throw new Error('Classic Studios is fixed to Hammer, Universal, Paramount, RKO and MGM.');
    if (!name) throw new Error('Give the list a name.');
    var all = dbRead('Collections');
    var clash = all.filter(function (c) { return c.family === family && matchKey_(c.name) === matchKey_(name); })[0];
    if (clash) throw new Error('There is already a ' + family + ' list called ' + clash.name + '.');
    var maxId = all.reduce(function (m, c) { return Math.max(m, Number(String(c.collection_id).slice(1)) || 0); }, 0);
    var maxOrder = all.reduce(function (m, c) { return Math.max(m, Number(c.sort_order) || 0); }, 0);
    var rec = { collection_id: 'C' + pad_(maxId + 1, 3), family: family, name: name,
      icon: String(icon || COLLECTION_ICON_DEFAULTS[family] || ''), description: String(description || ''),
      sort_order: maxOrder + 1, active: true, source_tab: 'app', created_at: nowIso_() };
    dbAppend('Collections', [rec]);
    audit_('create-collection', 'Collections', rec.collection_id, null, rec);
    return rec;
  });
}

/** Renames a list or edits its icon/description. Locked families can only change their description. */
function apiUpdateCollection(collectionId, patch) {
  return withWriteLock_(function () {
    var cur = dbIndex('Collections')[collectionId];
    if (!cur) throw new Error('Unknown list ' + collectionId);
    var locked = cur.family === 'Bestiary' || cur.family === 'Classics';
    var next = { collection_id: collectionId };
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      var name = String(patch.name || '').trim();
      if (!name) throw new Error('A list needs a name.');
      if (locked && name !== cur.name) throw new Error(cur.family + ' names are locked.');
      var clash = dbRead('Collections').filter(function (c) {
        return c.collection_id !== collectionId && c.family === cur.family && matchKey_(c.name) === matchKey_(name);
      })[0];
      if (clash) throw new Error('There is already a ' + cur.family + ' list called ' + clash.name + '.');
      next.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'icon') && !locked) next.icon = String(patch.icon || '');
    if (Object.prototype.hasOwnProperty.call(patch, 'description')) next.description = String(patch.description || '');
    dbUpdate('Collections', [next]);
    audit_('update-collection', 'Collections', collectionId, stripRow_(cur), next);
    return stripRow_(dbIndex('Collections')[collectionId]);
  });
}
