// =====================================================
// App — initialization, global helpers, menus, toasts
// =====================================================

// Toast system
function showToast(message, action, actionFn) {
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<span>' + escHtml(message) + '</span>';
  if (action && actionFn) {
    var btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action;
    btn.onclick = function() { actionFn(); toast.remove(); };
    toast.appendChild(btn);
  }
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
}

// Menu toggle
function toggleMenu(menuId) {
  var menu = document.getElementById(menuId);
  var isOpen = menu.classList.contains('open');
  closeAllMenus();
  if (!isOpen) {
    menu.classList.add('open');
    setTimeout(function() {
      document.addEventListener('click', function handler(e) {
        if (!menu.contains(e.target) && !menu.previousElementSibling.contains(e.target)) {
          menu.classList.remove('open');
          document.removeEventListener('click', handler);
        }
      });
    }, 50);
  }
}

function closeMenu(menuId) {
  var menu = document.getElementById(menuId);
  if (menu) menu.classList.remove('open');
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu.open').forEach(function(m) { m.classList.remove('open'); });
}

// Init
document.addEventListener('DOMContentLoaded', function() {
  loadInvestigations();
  initCaptureHandlers();

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (document.getElementById('reportOverlay').classList.contains('active')) {
        closeReport();
      }
    }
  });

  // PostMessage bridge — receive pins from The Data Wall or other dashboards
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'audit-angel-pin') return;
    var pin = e.data.pin;
    if (!pin) return;
    // If there are active investigations, add to the most recent one
    // Otherwise create a new investigation and add to it
    (async function() {
      var invs = await API.getInvestigations();
      var active = invs.filter(function(i) { return !i.completed_at; });
      var targetInv;
      if (active.length > 0) {
        targetInv = active[0]; // most recent active
      } else {
        targetInv = await API.createInvestigation('New Investigation');
      }
      await API.addPin(targetInv.id, pin);
      await loadInvestigations();
      showToast('Pin received: ' + (pin.title || 'Untitled'), 'View', function() { openReport(targetInv.id); });
    })();
  });
});
