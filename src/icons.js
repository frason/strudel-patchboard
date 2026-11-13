// Small outline icons (24x24, stroke = currentColor) for the toolbar.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  play: 'M7 4.5v15l12-7.5z', stop: 'M6.5 6.5h11v11h-11z', plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  newfile: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6', folder: 'M3 6h6l2 2h10v11H3z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  book: 'M3 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14', sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6',
  menu: 'M4 6h16M4 12h16M4 18h16', group: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4a3 3 0 0 1 3 3v4',
};
export function icon(name, size = 18) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('width', size); el.setAttribute('height', size); el.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name]);
  const solid = name === 'play' || name === 'stop';
  p.setAttribute('fill', solid ? 'currentColor' : 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', solid ? '1.5' : '1.8'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  el.append(p);
  return el;
}
