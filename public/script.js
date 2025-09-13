// script.js - No-Select/No-Copy Feature
// Prevents selection/copy/context menu for .no-select elements.
// See README in index.html for limitations and accessibility notes.

function setNoSelectProtection(enabled = true) {
  const protectedEls = document.querySelectorAll('.no-select, .no-copy, p.no-select, span.no-select');
  protectedEls.forEach(el => {
    if (enabled) {
      el.setAttribute('unselectable', 'on'); // legacy IE
      el.style.userSelect = 'none';
      el.style.webkitUserSelect = 'none';
      el.style.msUserSelect = 'none';
      el.style.MozUserSelect = 'none';
      el.style.webkitTouchCallout = 'none';
      // Block selection gestures
      el.addEventListener('selectstart', block, true);
      el.addEventListener('mousedown', block, true);
      el.addEventListener('mousemove', block, true);
      el.addEventListener('touchstart', block, true);
      el.addEventListener('touchmove', block, true);
      el.addEventListener('contextmenu', block, true);
      el.addEventListener('copy', blockCopy, true);
    } else {
      el.removeAttribute('unselectable');
      el.style.userSelect = '';
      el.style.webkitUserSelect = '';
      el.style.msUserSelect = '';
      el.style.MozUserSelect = '';
      el.style.webkitTouchCallout = '';
      el.removeEventListener('selectstart', block, true);
      el.removeEventListener('mousedown', block, true);
      el.removeEventListener('mousemove', block, true);
      el.removeEventListener('touchstart', block, true);
      el.removeEventListener('touchmove', block, true);
      el.removeEventListener('contextmenu', block, true);
      el.removeEventListener('copy', blockCopy, true);
    }
  });
}

function block(e) {
  e.preventDefault();
  e.stopPropagation();
}

function blockCopy(e) {
  const log = document.getElementById('log');
  log.textContent = 'Copy blocked on protected text!';
  setTimeout(() => { log.textContent = ''; }, 1800);
  e.preventDefault();
  e.stopPropagation();
}

// Defensive: block copy if selection is inside .no-select
// (works for keyboard shortcuts, not just mouse)
document.addEventListener('copy', function(e) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  let node = sel.anchorNode;
  while (node) {
    if (node.classList && node.classList.contains('no-select')) {
      const log = document.getElementById('log');
      log.textContent = 'Copy blocked on protected text!';
      setTimeout(() => { log.textContent = ''; }, 1800);
      e.preventDefault();
      e.stopPropagation();
      break;
    }
    node = node.parentNode;
  }
});

// Demo: toggle protection
const enableBtn = document.getElementById('enable-protect');
const disableBtn = document.getElementById('disable-protect');
enableBtn.onclick = () => setNoSelectProtection(true);
disableBtn.onclick = () => setNoSelectProtection(false);

// Enable by default on load
setNoSelectProtection(true);
