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

  // Auto-switch to custom sort after drag reorder
  if (_currentReportInv && _currentReportInv.pin_sort !== 'custom') {
    _currentReportInv.pin_sort = 'custom';
    document.getElementById('sortDropdown').value = 'custom';
    API.updateInvestigation(_currentReportId, { pin_sort: 'custom' });
  }

  await refreshReport();

  document.querySelectorAll('.report-pin').forEach(function(el) {
    el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  });
}

// Move/Copy menu state
var _moveMenuMode = 'move';       // 'move' | 'copy'
var _moveMenuSearch = '';
var _moveMenuShowArchived = false;
var _moveMenuPinId = null;

function showMoveMenu(pinId, btnEl) {
  closeMoveMenu();

  // Reset menu state on each open
  _moveMenuMode = 'move';
  _moveMenuSearch = '';
  _moveMenuShowArchived = false;
  _moveMenuPinId = pinId;

  // Check if pin is already in summary
  var pin = _currentReportInv && _currentReportInv.pins ? _currentReportInv.pins.find(function(p) { return p.id === pinId; }) : null;
  var inSummary = pin && pin.in_summary;

  var html = '<div class="pin-move-menu" id="moveMenu" onclick="event.stopPropagation()">';

  // Add to Summary option at top
  if (inSummary) {
    html += '<div class="pin-move-menu-item" onclick="togglePinSummary(\'' + pinId + '\',false)" style="color:var(--blue);font-weight:600;">&#10003; In Summary &mdash; Remove</div>';
  } else {
    html += '<div class="pin-move-menu-item" onclick="togglePinSummary(\'' + pinId + '\',true)" style="color:var(--blue);font-weight:600;">&#9734; Add to Summary</div>';
  }

  html += '<div style="border-top:1px solid #E5E7EB;margin:4px 0;"></div>';

  // Move/Copy toggle
  html += '<div class="pin-move-mode-toggle">'
    + '<button type="button" class="pin-move-mode-btn active" data-mode="move" onclick="setMoveMenuMode(\'move\')">&#8594; Move</button>'
    + '<button type="button" class="pin-move-mode-btn" data-mode="copy" onclick="setMoveMenuMode(\'copy\')">&#128203; Copy</button>'
    + '</div>';

  // Search input
  html += '<div class="pin-move-search-wrap">'
    + '<input type="text" class="pin-move-search" id="moveMenuSearch" placeholder="Search investigations..." oninput="onMoveMenuSearch(this.value)">'
    + '</div>';

  // Active list container
  html += '<div class="pin-move-list" id="moveMenuActiveList"></div>';

  // Archived section
  html += '<div class="pin-move-archived-wrap">'
    + '<div class="pin-move-archived-toggle" id="moveMenuArchivedToggle" onclick="toggleMoveMenuArchived()">'
    + '<span class="pin-move-archived-arrow" id="moveMenuArchivedArrow">&#9654;</span> '
    + 'Archived <span class="count-badge" id="moveMenuArchivedCount">0</span>'
    + '</div>'
    + '<div class="pin-move-archived-list" id="moveMenuArchivedList" style="display:none;"></div>'
    + '</div>';

  html += '</div>';
  btnEl.closest('.pin-action-bar').insertAdjacentHTML('beforeend', html);

  renderMoveMenuLists();

  // Focus the search input for immediate typing
  var searchInput = document.getElementById('moveMenuSearch');
  if (searchInput) searchInput.focus();

  setTimeout(function() { document.addEventListener('click', closeMoveMenu); }, 50);
}

function renderMoveMenuLists() {
  if (!_moveMenuPinId) return;
  var pinId = _moveMenuPinId;
  var q = _moveMenuSearch.toLowerCase();

  var activeInvs = _investigations.filter(function(i) {
    return !i.completed_at && i.id !== _currentReportId && (!q || i.name.toLowerCase().indexOf(q) !== -1);
  });
  var archivedInvs = _investigations.filter(function(i) {
    return !!i.completed_at && i.id !== _currentReportId && (!q || i.name.toLowerCase().indexOf(q) !== -1);
  });

  var icon = _moveMenuMode === 'move' ? '&#8594;' : '&#128203;';

  var activeHtml = '';
  if (activeInvs.length === 0) {
    activeHtml = '<div class="pin-move-empty">' + (q ? 'No matches' : 'No active investigations') + '</div>';
  } else {
    activeInvs.forEach(function(inv) {
      activeHtml += '<div class="pin-move-menu-item" onclick="handleMoveMenuClick(\'' + pinId + '\',\'' + inv.id + '\')">' + icon + ' ' + escHtml(inv.name) + '</div>';
    });
  }
  var activeEl = document.getElementById('moveMenuActiveList');
  if (activeEl) activeEl.innerHTML = activeHtml;

  var archivedHtml = '';
  if (archivedInvs.length === 0) {
    archivedHtml = '<div class="pin-move-empty">' + (q ? 'No matches' : 'No archived investigations') + '</div>';
  } else {
    archivedInvs.forEach(function(inv) {
      archivedHtml += '<div class="pin-move-menu-item" onclick="handleMoveMenuClick(\'' + pinId + '\',\'' + inv.id + '\')">' + icon + ' ' + escHtml(inv.name) + '</div>';
    });
  }
  var archivedEl = document.getElementById('moveMenuArchivedList');
  if (archivedEl) archivedEl.innerHTML = archivedHtml;

  var countEl = document.getElementById('moveMenuArchivedCount');
  if (countEl) countEl.textContent = archivedInvs.length;
}

function setMoveMenuMode(mode) {
  _moveMenuMode = mode;
  var btns = document.querySelectorAll('#moveMenu .pin-move-mode-btn');
  btns.forEach(function(b) {
    if (b.getAttribute('data-mode') === mode) b.classList.add('active');
    else b.classList.remove('active');
  });
  renderMoveMenuLists();
}

function onMoveMenuSearch(value) {
  _moveMenuSearch = value;
  renderMoveMenuLists();
}

function toggleMoveMenuArchived() {
  _moveMenuShowArchived = !_moveMenuShowArchived;
  var list = document.getElementById('moveMenuArchivedList');
  var arrow = document.getElementById('moveMenuArchivedArrow');
  if (list) list.style.display = _moveMenuShowArchived ? '' : 'none';
  if (arrow) arrow.innerHTML = _moveMenuShowArchived ? '&#9660;' : '&#9654;';
}

function handleMoveMenuClick(pinId, targetInvId) {
  if (_moveMenuMode === 'copy') {
    copyPin(pinId, targetInvId);
  } else {
    movePin(pinId, targetInvId);
  }
}

function closeMoveMenu() {
  var menu = document.getElementById('moveMenu');
  if (menu) menu.remove();
  _moveMenuPinId = null;
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

// --- Add/remove images on saved pins ---
function addImageToPin(pinId) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = function() { handlePinImageFiles(pinId, input.files); };
  input.click();
}

function handlePinImageFiles(pinId, files) {
  if (!files || files.length === 0) return;
  var remaining = 0;
  for (var i = 0; i < files.length; i++) {
    if (!files[i].type.startsWith('image/')) continue;
    remaining++;
    (function(file) {
      var reader = new FileReader();
      reader.onload = function(e) {
        compressImage(e.target.result, async function(compressed) {
          await API.addImages(pinId, { data_url: compressed, caption: '', link: '' });
          remaining--;
          if (remaining === 0) {
            await refreshReport();
            showToast('Image added');
          }
        });
      };
      reader.readAsDataURL(file);
    })(files[i]);
  }
}

async function deletePinImage(imageId) {
  if (!confirm('Remove this image?')) return;
  await API.deleteImage(imageId);
  await refreshReport();
  showToast('Image removed');
}

function setupPinImagePaste(editor, pinId) {
  editor.addEventListener('paste', function(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        var file = items[i].getAsFile();
        handlePinImageFiles(pinId, [file]);
        break;
      }
    }
  });
}

async function togglePinSummary(pinId, addToSummary) {
  closeMoveMenu();
  await API.updatePin(pinId, { in_summary: addToSummary });
  await refreshReport();
  showToast(addToSummary ? 'Added to summary' : 'Removed from summary');
}
