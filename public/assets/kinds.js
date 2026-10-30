// Colors and line icons for the kinds of assignment, shared by every page.
// Each color is dark enough to carry white text and to read as text on white.
// The ten kinds in the starting settings.json have their own icon. Any other kind gets a color by its
// place in the list, and the icon named in its "icon" field in settings.json, or a plain one.
(function () {
  const ICONS = {
    presentation: '<rect x="3" y="4" width="18" height="11" rx="1.5"/><path d="M12 15v5M8 20h8M7 11l3-3 2 2 4-4"/>',
    client: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
    writing: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>',
    case: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
    exam: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 12l2 2 4-4"/>',
    data: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="9"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/>',
    reflection: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    discussion: '<path d="M4 5h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M18 9h2a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3-3h-3"/>',
    simulation: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/>',
    pitch: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/><path d="M7.5 15h9"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  };
  const KNOWN = {
    teampres: ['#0E7C55', 'presentation'], client: ['#2367A8', 'client'], writing: ['#7A4CA0', 'writing'], case: ['#B8502A', 'case'],
    exams: ['#8C6D00', 'exam'], problems: ['#0F7F86', 'data'], reflect: ['#A8436F', 'reflection'], discuss: ['#4B57B8', 'discussion'],
    sim: ['#C0661F', 'simulation'], pitch: ['#5E7D1C', 'pitch'],
  };
  const PALETTE = ['#0E7C55', '#2367A8', '#7A4CA0', '#B8502A', '#8C6D00', '#0F7F86', '#A8436F', '#4B57B8', '#C0661F', '#5E7D1C',
    '#7B5B3A', '#9A3B3B', '#3E6B5A', '#5A4E9C', '#8A5A00', '#2F6F8F'];
  let map = {};
  // Each page calls this once it has the settings from api/config.
  window.labKinds = (list) => {
    map = {};
    (list || []).forEach((a, i) => {
      const k = KNOWN[a.id];
      const used = new Set(Object.values(map).map((m) => m[0]));
      const color = k && !used.has(k[0]) ? k[0] : PALETTE.find((c) => !used.has(c)) || PALETTE[i % PALETTE.length];
      map[a.id] = [color, ICONS[a.icon] ? a.icon : k ? k[1] : 'other'];
    });
  };
  window.kindColor = (id) => (map[id] || ['#5C6360'])[0];
  window.kindIcon = (id) => '<svg class="kicon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    ICONS[(map[id] || [0, 'other'])[1]] + '</svg>';
  // Initials for a name, for the round badges beside each person.
  window.initials = (name) => {
    const w = String(name).trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  };
})();
