// Small UI helpers: bottom sheet, toast, safe HTML.
const $ = s => document.querySelector(s);
export { $ };

export const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

let current = null;
export function openSheet(name, title, html, onMount) {
  current = name;
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  document.querySelectorAll('.toolbar button[data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
  onMount?.($('#sheetBody'));
}
export function closeSheet() {
  current = null;
  $('#sheet').classList.add('hidden');
  document.querySelectorAll('.toolbar button[data-panel]').forEach(b => b.classList.remove('on'));
}
export const sheetOpen = () => current;

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

export const COLORS = ['#7d3cff', '#d63b2f', '#1e88e5', '#2e7d32', '#ef6c00', '#212121'];
export function swatches(selected) {
  return `<div class="swatches">${COLORS.map(c => `<button type="button" class="swatch${c === selected ? ' sel' : ''}" data-color="${c}" style="background:${c}" aria-label="צבע"></button>`).join('')}</div>`;
}
export function bindSwatches(root, onPick) {
  root.querySelectorAll('.swatch').forEach(b => b.onclick = () => {
    root.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel'); onPick(b.dataset.color);
  });
}
