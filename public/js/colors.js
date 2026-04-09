// =====================================================
// Custom Colors — add, persist, render across all pickers
// =====================================================

var _customPinColors = [];
var _defaultPinColors = [
  { value: 'red', hex: '#DC2626', label: 'Red' },
  { value: 'yellow', hex: '#D97706', label: 'Yellow' },
  { value: 'green', hex: '#00B373', label: 'Green' },
  { value: 'blue', hex: '#0075EB', label: 'Blue' }
];

function getAllPinColors() {
  var all = _defaultPinColors.slice();
  _customPinColors.forEach(function(c) {
    all.push({ value: c.id, hex: c.hex, label: c.label, custom: true });
  });
  return all;
}

function getColorHex(colorValue) {
  if (!colorValue) return null;
  var all = getAllPinColors();
  for (var i = 0; i < all.length; i++) {
    if (all[i].value === colorValue) return all[i].hex;
  }
  return null;
}

function getColorLabel(colorValue) {
  if (!colorValue) return 'No color';
  var all = getAllPinColors();
  for (var i = 0; i < all.length; i++) {
    if (all[i].value === colorValue) return all[i].label;
  }
  return colorValue;
}

function saveCustomColors() {
  API._fetch('/api/preferences/custom_pin_colors', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: _customPinColors })
  }).catch(function(err) { console.error('Save custom colors failed:', err); });
}

function addCustomColor(hex, label) {
  var id = 'custom-' + Date.now();
  _customPinColors.push({ id: id, hex: hex, label: label || hex });
  saveCustomColors();
  return id;
}

function showAddColorPopover(anchorEl, onAdd) {
  var old = document.getElementById('addColorPopover');
  if (old) old.remove();
  var pop = document.createElement('div');
  pop.id = 'addColorPopover';
  pop.style.cssText = 'position:fixed;z-index:700;background:#fff;border:1px solid var(--border);border-radius:12px;padding:14px;box-shadow:var(--shadow-lg);min-width:200px;';
  pop.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">Add Custom Color</div>'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
    + '<input type="color" id="customColorInput" value="#8B5CF6" style="width:36px;height:28px;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:0;">'
    + '<input type="text" id="customColorLabel" placeholder="Label (e.g. Key Finding)" style="flex:1;border:1.5px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;font-family:Poppins,sans-serif;outline:none;">'
    + '</div>'
    + '<div style="display:flex;gap:6px;">'
    + '<button id="customColorSaveBtn" class="btn-sm btn-primary">Add</button>'
    + '<button id="customColorCancelBtn" class="btn-sm btn-light">Cancel</button>'
    + '</div>';
  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8) + 'px';
  pop.querySelector('#customColorLabel').focus();
  pop.querySelector('#customColorSaveBtn').onclick = function() {
    var hex = pop.querySelector('#customColorInput').value;
    var label = pop.querySelector('#customColorLabel').value.trim() || hex;
    addCustomColor(hex, label);
    pop.remove();
    if (onAdd) onAdd();
  };
  pop.querySelector('#customColorCancelBtn').onclick = function() { pop.remove(); };
  pop.querySelector('#customColorLabel').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') pop.querySelector('#customColorSaveBtn').click();
    if (e.key === 'Escape') pop.remove();
  });
  setTimeout(function() {
    document.addEventListener('mousedown', function handler(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', handler); }
    });
  }, 0);
}

async function loadCustomColors() {
  try {
    var prefs = await API._fetch('/api/preferences');
    if (prefs && prefs.custom_pin_colors) _customPinColors = prefs.custom_pin_colors;
  } catch(e) {}
}
