// Small outline icons (24x24, stroke = currentColor) for the toolbar.
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  play: 'M7 4.5v15l12-7.5z', stop: 'M6.5 6.5h11v11h-11z', plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  newfile: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6', folder: 'M3 6h6l2 2h10v11H3z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  book: 'M3 5h6a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h7z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14', sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6',
  sparkle: 'M12 3l2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1zM19 3v4M17 5h4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  hand: 'M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  select: 'M4 4h3M10 4h4M17 4h3M20 4v3M20 10v4M20 17v3M20 20h-3M14 20h-4M7 20H4M4 20v-3M4 14v-4M4 7V4M12 9v6M9 12h6',
  duplicate: 'M9 9h11v11H9zM5 15V4h11',
  collapse: 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5',
  expand: 'M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6',
  unmute: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12',
  alignleft: 'M4 3v18M8 7h12M8 13h8',
  aligntop: 'M3 4h18M7 8v12M13 8v8',
  trash: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  close: 'M6 6l12 12M18 6L6 18', group: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h4a3 3 0 0 1 3 3v4',
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
