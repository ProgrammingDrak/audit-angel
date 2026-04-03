// =====================================================
// Pin Operations — add, remove, move, copy, reorder, color
// =====================================================

async function addPinToInvestigation(invId, pinData) {
  await API.addPin(invId, pinData);
  await loadInvestigations();
  if (_currentReportId === invId) await refreshReport();
  showToast('Pin added');
}

async function removePinFromReport(pinId) {
  if (!_currentReportId) return;
  if (!confirm('Remove this pin?')) return;
  await API.deletePin(pinId);
  await refreshReport();
  await loadInvestigations();
}

async function setPinColor(pinId, color) {
  await API.updatePin(pinId, { color: color || null });
  await refreshReport();
}

async function updatePinNote(pinId, note) {
  await API.updatePin(pinId, { note: note });
}

// Drag and drop reorder
var _dragPinId = null;

function onPinDragStart(e, pinId) {
  _dragPinId = pinId;
  e.dataTransfer.effectAllowed = 'move';
  e.target.closest('.report-pin').classList.add('dragging');
}

function onPinDragEnd(e) {
  _dragPinId = null;
  document.querySelectorAll('.report-pin').forEach(function(el) {
    el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  });
}

function onPinDragOver(e, pinId) {
  e.preventDefault();
  if (_dragPinId === pinId) return;
  var el = e.target.closest('.report-pin');
  if (!el) return;
  var rect = el.getBoundingClientRect();
  var mid = rect.top + rect.height / 2;
  el.classList.remove('drag-over-top', 'drag-over-bottom');
  if (e.clientY < mid) el.classList.add('drag-over-top');
  else el.classList.add('drag-over-bottom');
}

function onPinDragLeave(e) {
  var el = e.target.closest('.report-pin');
  if (el) el.classList.remove('drag-over-top', 'drag-over-bottom');
}

async function onPinDrop(e, targetPinId) {
  e.preventDefault();
  if (!_dragPinId || _dragPinId === targetPinId || !_currentReportInv) return;

  var pins = _currentReportInv.pins;
  var fromIdx = pins.findIndex(function(p) { return p.id === _dragPinId; });
  var toIdx = pins.findIndex(function(p) { return p.id === targetPinId; });
  if (fromIdx === -1 || toIdx === -1) return;

  // Determine insert position
  var el = document.getElementById('pin-' + targetPinId);
  if (el && el.classList.contains('drag-over-bottom')) toIdx++;
  if (fromIdx < toIdx) toIdx--;

  var moved = pins.splice(fromIdx, 1)[0];
  pins.splice(toIdx, 0, moved);

  var pinIds = pins.map(function(p) { return p.id; });
  await API.reorderPins(_currentReportId, pinIds);
  await refreshReport();

  document.querySelectorAll('.report-pin').forEach(function(el) {
    el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  });
}

// Move/Copy menu
function showMoveMenu(pinId, btnEl) {
  closeMoveMenu();
  var activeInvs = _investigations.filter(function(i) { return !i.completed_at && i.id !== _currentReportId; });
  var html = '<div class="pin-move-menu" id="moveMenu">'
    + '<div class="pin-move-menu-header">Move or copy to...</div>';
  activeInvs.forEach(function(inv) {
    html += '<div class="pin-move-menu-item" onclick="movePin(\'' + pinId + '\',\'' + inv.id + '\')">&#8594; ' + escHtml(inv.name) + '</div>';
    html += '<div class="pin-move-menu-item" onclick="copyPin(\'' + pinId + '\',\'' + inv.id + '\')">&#128203; Copy to ' + escHtml(inv.name) + '</div>';
  });
  html += '</div>';
  btnEl.closest('.pin-action-bar').insertAdjacentHTML('beforeend', html);
  setTimeout(function() { document.addEventListener('click', closeMoveMenu); }, 50);
}

function closeMoveMenu() {
  var menu = document.getElementById('moveMenu');
  if (menu) menu.remove();
  document.removeEventListener('click', closeMoveMenu);
}

async function movePin(pinId, targetInvId) {
  closeMoveMenu();
  await API.movePin(pinId, targetInvId);
  await refreshReport();
  await loadInvestigations();
  showToast('Pin moved');
}

async function copyPin(pinId, targetInvId) {
  closeMoveMenu();
  await API.copyPin(pinId, targetInvId);
  await loadInvestigations();
  showToast('Pin copied');
}
