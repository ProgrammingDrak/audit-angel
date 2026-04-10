// =====================================================
// Report Modal — open, render, color filter, collapse
// =====================================================

var _currentReportId = null;
var _currentReportInv = null;
var _colorFilters = [];
var _imagesHidden = false;

async function openReport(invId) {
  _currentReportId = invId;
  _colorFilters = [];
  _imagesHidden = false;
  var inv = await API.getInvestigation(invId);
  _currentReportInv = inv;

  document.getElementById('reportTitle').textContent = inv.name;
  var dateStr = new Date(inv.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var subtitle = inv.pins.length + ' pins -- Created ' + dateStr;
  if (inv.completed_at) subtitle += ' -- Completed ' + new Date(inv.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  document.getElementById('reportSubtitle').textContent = subtitle;
  document.getElementById('reportSummary').value = inv.summary || '';

  updateCompleteBtn(inv);
  document.getElementById('sortDropdown').value = inv.pin_sort || 'newest';
  renderReportPins(inv);
  updateColorFilterUI();

  // Default to Notes tab with note form open
  switchReportTab('notes');
  document.getElementById('reportOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  showAddNoteForm();

  // Update URL hash for deep linking
  history.replaceState(null, '', window.location.pathname + window.location.search + '#investigation=' + invId);
}

function closeReport() {
  // Auto-save summary
  var summaryEl = document.getElementById('reportSummary');
  var summary = summaryEl ? summaryEl.value : '';
  if (_currentReportId && _currentReportInv && summary !== (_currentReportInv.summary || '')) {
    API.updateInvestigation(_currentReportId, { summary: summary });
  }
  _currentReportId = null;
  _currentReportInv = null;
  document.getElementById('reportOverlay').classList.remove('active');
  document.body.style.overflow = '';
  hideAddNoteForm();
  loadInvestigations();
  // Clear hash
  if (window.location.hash.indexOf('investigation=') !== -1) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// --- Investigation Deep Links ---
function copyInvestigationLink() {
  if (!_currentReportId) return;
  var url = window.location.origin + window.location.pathname + '#investigation=' + _currentReportId;
  navigator.clipboard.writeText(url).then(function() {
    showToast('Link copied to clipboard');
  });
}

function checkInvestigationHash() {
  var hash = window.location.hash;
  if (!hash) return;
  var match = hash.match(/investigation=([^&]+)/);
  if (!match) return;
  var invId = match[1];
  setTimeout(function() { openReport(invId); }, 200);
}

async function refreshReport() {
  if (!_currentReportId) return;
  var inv = await API.getInvestigation(_currentReportId);
  _currentReportInv = inv;
  renderReportPins(inv);
  var dateStr = new Date(inv.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.getElementById('reportSubtitle').textContent = inv.pins.length + ' pins -- Created ' + dateStr;
  updateCompleteBtn(inv);
  var summaryTab = document.getElementById('tabSummary');
  if (summaryTab && summaryTab.style.display !== 'none') {
    renderSummaryPins();
  }
}

function renderReportPins(inv) {
  var body = document.getElementById('reportBody');
  if (!inv.pins || inv.pins.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#6B7280;font-size:13px;">No pins yet. Add a note or pin data from another tool.</div>';
    return;
  }

  var sortMode = inv.pin_sort || 'newest';
  var sortedPins = inv.pins.slice();
  if (sortMode === 'newest') {
    sortedPins.sort(function(a, b) { return new Date(b.pinned_at) - new Date(a.pinned_at); });
  } else if (sortMode === 'oldest') {
    sortedPins.sort(function(a, b) { return new Date(a.pinned_at) - new Date(b.pinned_at); });
  }

  var html = '';
  sortedPins.forEach(function(pin, idx) {
    html += renderSinglePin(pin, idx, inv.id);
  });
  body.innerHTML = html;

  applyColorFilter();
  initPinDragHandlers();
}

function renderSinglePin(pin, idx, invId) {
  // Support custom colors via inline style
  var isDefaultColor = ['red','yellow','green','blue'].indexOf(pin.color) !== -1;
  var colorClass = isDefaultColor ? ' color-' + pin.color : '';
  var customStyle = '';
  if (pin.color && !isDefaultColor) {
    var hex = getColorHex(pin.color);
    if (hex) customStyle = 'border-left:4px solid ' + hex + ';background:linear-gradient(90deg, ' + hex + '0a 0%, transparent 40%);';
  }
  var typeClass = ' type-' + (pin.type || 'note');
  var timeStr = pin.pinned_at ? new Date(pin.pinned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  var html = '<div class="report-pin' + colorClass + '" id="pin-' + pin.id + '" data-color="' + (pin.color || '') + '" '
    + 'style="' + customStyle + '" '
    + 'draggable="true" ondragstart="onPinDragStart(event,\'' + pin.id + '\')" ondragend="onPinDragEnd(event)" '
    + 'ondragover="onPinDragOver(event,\'' + pin.id + '\')" ondragleave="onPinDragLeave(event)" ondrop="onPinDrop(event,\'' + pin.id + '\')">';

  // Header
  html += '<div class="pin-header" onclick="togglePin(\'' + pin.id + '\')">';
  html += '<span class="pin-drag-handle" onclick="event.stopPropagation()">&#8942;&#8942;</span>';
  html += '<span class="pin-expand">&#9654;</span>';
  html += '<span class="pin-type-badge' + typeClass + '">' + (pin.type || 'note').toUpperCase() + '</span>';
  if (pin.source) html += '<span style="font-size:10px;color:#6B7280;">' + escHtml(pin.source) + '</span>';
  html += '<span class="pin-title">' + escHtml(pin.title || 'Untitled') + '</span>';
  html += '<span class="pin-time">' + timeStr + '</span>';

  // Action buttons
  html += '<div class="pin-action-bar" onclick="event.stopPropagation()">';
  html += renderColorPicker(pin.id, pin.color);
  html += '<button class="pin-action-btn" onclick="copyPinToClipboard(\'' + pin.id + '\')" title="Copy to clipboard">&#128203;</button>';
  html += '<button class="pin-action-btn" onclick="showMoveMenu(\'' + pin.id + '\',this)" title="Move/Copy">&#8596;</button>';
  html += '<button class="pin-action-btn danger" onclick="removePinFromReport(\'' + pin.id + '\')" title="Remove">&#128465;</button>';
  html += '</div>';
  html += '</div>';

  // Details
  html += '<div class="pin-details">';

  // Images
  if (pin.images && pin.images.length > 0 && !_imagesHidden) {
    html += '<div class="pin-image-gallery">';
    pin.images.forEach(function(img) {
      html += '<div class="pin-image-wrap">';
      html += '<img src="' + img.data_url + '" alt="' + escHtml(img.caption || '') + '" onclick="window.open(this.src)">';
      if (img.caption || img.link) {
        html += '<div class="pin-image-meta">';
        if (img.caption) html += '<div>' + escHtml(img.caption) + '</div>';
        if (img.link) html += '<div><a href="' + escHtml(img.link) + '" target="_blank">' + escHtml(img.link).substring(0, 50) + (img.link.length > 50 ? '...' : '') + '</a></div>';
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // Note (read-only with edit-on-click)
  if (pin.note) {
    html += '<div class="pin-note-display" data-pin="' + pin.id + '" onclick="enterPinNoteEdit(this)">'
      + '<span class="pin-note-edit-hint" style="position:absolute;top:6px;right:8px;font-size:11px;color:var(--text-muted);opacity:0;transition:opacity 0.15s;">&#9998; Edit</span>'
      + renderMarkdown(pin.note)
      + '</div>';
  } else {
    html += '<div class="pin-note-display pin-note-empty" data-pin="' + pin.id + '" onclick="enterPinNoteEdit(this)">Click to add a note...</div>';
  }
  html += '<textarea class="text-area pin-note-editor" data-pin="' + pin.id + '" style="display:none;min-height:36px;margin:8px 0;font-size:12px;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,117,235,0.08);" placeholder="Add a note...">' + escHtml(pin.note || '') + '</textarea>';

  // Data fields
  var data = pin.data || {};
  var keys = Object.keys(data);
  if (keys.length > 0) {
    html += '<table class="pin-data-table">';
    keys.forEach(function(k) {
      var val = data[k];
      if (val === null || val === undefined || val === '') return;
      if (typeof val === 'object') val = JSON.stringify(val);
      html += '<tr><td>' + humanizeKey(k) + '</td><td>' + escHtml(String(val)) + '</td></tr>';
    });
    html += '</table>';
  }

  // Children
  if (pin.children && pin.children.length > 0) {
    html += '<div class="pin-children">';
    pin.children.forEach(function(child, childIdx) {
      html += renderSinglePin(child, childIdx, invId);
    });
    html += '</div>';
  }

  html += '</div>'; // pin-details
  html += '</div>'; // report-pin
  return html;
}

// --- Pin Note Edit-in-Place ---
function enterPinNoteEdit(displayEl) {
  var pinId = displayEl.getAttribute('data-pin');
  var editor = displayEl.nextElementSibling;
  if (!editor || !editor.classList.contains('pin-note-editor')) return;

  // Measure display element BEFORE hiding so the editor can match its footprint
  var rect = displayEl.getBoundingClientRect();
  var width = rect.width;
  var height = Math.max(displayEl.offsetHeight, 36);

  displayEl.style.display = 'none';
  editor.style.display = '';
  editor.style.boxSizing = 'border-box';
  editor.style.width = width + 'px';
  editor.style.height = height + 'px';
  editor.style.padding = '6px 10px';
  editor.style.lineHeight = '1.5';
  editor.focus();
  editor.selectionStart = editor.selectionEnd = editor.value.length;
  setupSmartLinkPaste(editor);
  editor.onblur = function() {
    var newNote = editor.value;
    updatePinNote(pinId, newNote);
    if (newNote) {
      displayEl.className = 'pin-note-display';
      displayEl.innerHTML = '<span class="pin-note-edit-hint" style="position:absolute;top:6px;right:8px;font-size:11px;color:var(--text-muted);opacity:0;transition:opacity 0.15s;">&#9998; Edit</span>'
        + renderMarkdown(newNote);
    } else {
      displayEl.className = 'pin-note-display pin-note-empty';
      displayEl.innerHTML = 'Click to add a note...';
    }
    // Clear inline sizing so the next edit re-measures fresh
    editor.style.width = '';
    editor.style.height = '';
    editor.style.padding = '';
    editor.style.lineHeight = '';
    editor.style.display = 'none';
    displayEl.style.display = '';
  };
}

// --- Color Picker (per-pin) ---
function renderColorPicker(pinId, currentColor) {
  var colors = getAllPinColors();
  var html = '<span class="color-picker" onclick="event.stopPropagation()">';
  colors.forEach(function(c) {
    var active = currentColor === c.value ? ' active' : '';
    var cls = !c.custom ? ' sw-' + c.value : '';
    var style = c.custom ? ' style="background:' + c.hex + ';width:14px;height:14px;"' : ' style="width:14px;height:14px;"';
    html += '<span class="color-swatch' + cls + active + '"' + style + ' onclick="setPinColor(\'' + pinId + '\',\'' + c.value + '\')" title="' + c.label + '"></span>';
  });
  var noneActive = !currentColor ? ' active' : '';
  html += '<span class="color-swatch sw-none' + noneActive + '" style="width:14px;height:14px;" onclick="setPinColor(\'' + pinId + '\',null)" title="None"></span>';
  html += '</span>';
  return html;
}

// --- Copy Pin to Clipboard ---
function copyPinToClipboard(pinId) {
  if (!_currentReportInv) return;
  var pin = _currentReportInv.pins.find(function(p) { return p.id === pinId; });
  if (!pin) return;

  var plainText = (pin.title || '') + '\n';
  if (pin.note) plainText += '\n' + pin.note;
  var data = pin.data || {};
  var dataLines = [];
  Object.keys(data).forEach(function(k) {
    if (data[k] !== null && data[k] !== undefined) dataLines.push(k + ': ' + data[k]);
  });
  if (dataLines.length) plainText += '\n\n' + dataLines.join('\n');

  var images = pin.images || [];
  if (images.length > 0) {
    var htmlContent = '<div style="font-family:Poppins,sans-serif;">'
      + '<strong>' + escHtml(pin.title || '') + '</strong><br>';
    if (pin.note) htmlContent += '<div>' + renderMarkdown(pin.note) + '</div>';
    images.forEach(function(img) {
      htmlContent += '<img src="' + img.data_url + '" style="max-width:600px;border-radius:8px;margin:8px 0;">';
      if (img.caption) htmlContent += '<div style="font-size:11px;color:#6B7280;font-style:italic;">' + escHtml(img.caption) + '</div>';
    });
    htmlContent += '</div>';
    try {
      navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([htmlContent], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' })
        })
      ]).then(function() { showToast('Copied to clipboard (with images)'); })
        .catch(function() { navigator.clipboard.writeText(plainText).then(function() { showToast('Copied to clipboard'); }); });
    } catch(e) {
      navigator.clipboard.writeText(plainText).then(function() { showToast('Copied to clipboard'); });
    }
  } else {
    navigator.clipboard.writeText(plainText).then(function() { showToast('Copied to clipboard'); });
  }
}

function togglePin(pinId) {
  var el = document.getElementById('pin-' + pinId);
  if (el) el.classList.toggle('collapsed');
}

function collapseAllPins() {
  document.querySelectorAll('.report-pin').forEach(function(el) { el.classList.add('collapsed'); });
}

function expandAllPins() {
  document.querySelectorAll('.report-pin').forEach(function(el) { el.classList.remove('collapsed'); });
}

function toggleImages() {
  _imagesHidden = !_imagesHidden;
  var btn = document.getElementById('toggleImagesBtn');
  btn.textContent = _imagesHidden ? 'Show Images' : 'Hide Images';
  if (_currentReportInv) renderReportPins(_currentReportInv);
}

// Color filter
function toggleColorFilter(color) {
  var idx = _colorFilters.indexOf(color);
  if (idx !== -1) _colorFilters.splice(idx, 1);
  else _colorFilters.push(color);
  applyColorFilter();
  updateColorFilterUI();
}

function clearColorFilter() {
  _colorFilters = [];
  applyColorFilter();
  updateColorFilterUI();
}

function applyColorFilter() {
  if (_colorFilters.length === 0) {
    document.querySelectorAll('.report-pin').forEach(function(el) { el.style.display = ''; });
    var status = document.getElementById('filterStatus');
    if (status) status.textContent = '';
    return;
  }
  var shown = 0, total = 0;
  document.querySelectorAll('#reportBody > .report-pin').forEach(function(el) {
    total++;
    var pinColor = el.dataset.color || 'none';
    if (_colorFilters.indexOf(pinColor) !== -1 || (_colorFilters.indexOf('none') !== -1 && !el.dataset.color)) {
      el.style.display = '';
      shown++;
    } else {
      el.style.display = 'none';
    }
  });
  var status = document.getElementById('filterStatus');
  if (status) status.textContent = 'Showing ' + shown + ' of ' + total + ' pins';
}

function updateColorFilterUI() {
  // Dynamically render filter swatches including custom colors
  var container = document.getElementById('filterSwatches');
  if (container) {
    var colors = getAllPinColors();
    var html = '';
    colors.forEach(function(c) {
      var active = _colorFilters.indexOf(c.value) !== -1 ? ' active' : '';
      var cls = !c.custom ? ' sw-' + c.value : '';
      var style = c.custom ? ' style="background:' + c.hex + ';"' : '';
      html += '<span class="color-swatch' + cls + active + '"' + style + ' onclick="toggleColorFilter(\'' + c.value + '\')" title="' + c.label + '"></span>';
    });
    var noneActive = _colorFilters.indexOf('none') !== -1 ? ' active' : '';
    html += '<span class="color-swatch sw-none' + noneActive + '" onclick="toggleColorFilter(\'none\')" title="Uncolored"></span>';
    // Add-custom-color button — adding a color here makes it available to all pin/note pickers globally
    html += '<span class="color-swatch color-swatch-add" onclick="showAddColorPopover(this,function(){updateColorFilterUI();refreshReport();})" title="Add custom color">+</span>';
    container.innerHTML = html;
  }
  var clearBtn = document.getElementById('filterClearBtn');
  if (clearBtn) clearBtn.style.display = _colorFilters.length > 0 ? '' : 'none';
}

function updateCompleteBtn(inv) {
  var btn = document.getElementById('completeToggleBtn');
  if (inv.completed_at) {
    btn.innerHTML = '&#8634; Reopen';
    btn.style.background = '#6B7280';
  } else {
    btn.innerHTML = '&#10003; Mark Complete';
    btn.style.background = '#0075EB';
  }
}

async function toggleCompleteFromModal() {
  if (!_currentReportId || !_currentReportInv) return;
  if (_currentReportInv.completed_at) {
    await API.reopenInvestigation(_currentReportId);
  } else {
    await API.completeInvestigation(_currentReportId);
  }
  await refreshReport();
  showToast(_currentReportInv.completed_at ? 'Investigation completed' : 'Investigation reopened');
}

async function saveReportSummary() {
  if (!_currentReportId) return;
  var summary = document.getElementById('reportSummary').value;
  await API.updateInvestigation(_currentReportId, { summary: summary });
  showToast('Summary saved');
}

function initPinDragHandlers() {
  // Drag handlers are attached via inline event attributes in renderSinglePin
}

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^\w/, function(c) { return c.toUpperCase(); });
}

// Tab switching
function switchReportTab(tab) {
  var notesTab = document.getElementById('tabNotes');
  var summaryTab = document.getElementById('tabSummary');
  var addNoteBtn = document.getElementById('actionAddNote');

  document.querySelectorAll('.report-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  if (tab === 'notes') {
    notesTab.style.display = '';
    summaryTab.style.display = 'none';
    if (addNoteBtn) addNoteBtn.style.display = '';
  } else {
    notesTab.style.display = 'none';
    summaryTab.style.display = '';
    if (addNoteBtn) addNoteBtn.style.display = 'none';
    hideAddNoteForm();
    renderSummaryPins();
  }
}

function renderSummaryPins() {
  var body = document.getElementById('summaryPinsBody');
  if (!_currentReportInv || !_currentReportInv.pins) {
    body.innerHTML = '';
    return;
  }

  var summaryPins = _currentReportInv.pins.filter(function(p) { return p.in_summary; });
  if (summaryPins.length === 0) {
    body.innerHTML = '';
    return;
  }

  var html = '<div style="padding:8px 24px 4px;"><span style="font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em;">Pinned to Summary (' + summaryPins.length + ')</span></div>';
  summaryPins.forEach(function(pin) {
    html += renderSummaryPin(pin);
  });
  body.innerHTML = html;
}

function renderSummaryPin(pin) {
  var colorClass = pin.color ? ' color-' + pin.color : '';
  var timeStr = pin.pinned_at ? new Date(pin.pinned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  var html = '<div class="report-pin' + colorClass + '" data-color="' + (pin.color || '') + '">';
  html += '<div class="pin-header" onclick="togglePin(\'' + pin.id + '-sum\')" style="cursor:pointer;">';
  html += '<span class="pin-expand">&#9654;</span>';
  html += '<span class="summary-pin-badge">In Summary</span>';
  html += '<span class="pin-title">' + escHtml(pin.title || 'Untitled') + '</span>';
  html += '<span class="pin-time">' + timeStr + '</span>';
  html += '<div class="pin-action-bar" onclick="event.stopPropagation()">';
  html += '<button class="btn-sm btn-light" style="font-size:11px;padding:3px 10px;" onclick="togglePinSummary(\'' + pin.id + '\',false)">Remove from Summary</button>';
  html += '</div>';
  html += '</div>';

  html += '<div class="pin-details">';
  if (pin.images && pin.images.length > 0) {
    html += '<div class="pin-image-gallery">';
    pin.images.forEach(function(img) {
      html += '<div class="pin-image-wrap">';
      html += '<img src="' + img.data_url + '" alt="' + escHtml(img.caption || '') + '" onclick="window.open(this.src)">';
      html += '</div>';
    });
    html += '</div>';
  }
  if (pin.note) {
    html += '<div class="pin-note">' + renderMarkdown(pin.note) + '</div>';
  }
  var data = pin.data || {};
  var keys = Object.keys(data);
  if (keys.length > 0) {
    html += '<table class="pin-data-table">';
    keys.forEach(function(k) {
      var val = data[k];
      if (val === null || val === undefined || val === '') return;
      if (typeof val === 'object') val = JSON.stringify(val);
      html += '<tr><td>' + humanizeKey(k) + '</td><td>' + escHtml(String(val)) + '</td></tr>';
    });
    html += '</table>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

// Pin sort mode
async function changePinSort(mode) {
  if (!_currentReportId) return;
  document.getElementById('sortDropdown').value = mode;
  await API.updateInvestigation(_currentReportId, { pin_sort: mode });
  _currentReportInv.pin_sort = mode;
  renderReportPins(_currentReportInv);
}

// Export dropdown toggle
function toggleExportDropdown() {
  var dd = document.getElementById('exportDropdown');
  dd.style.display = dd.style.display === 'none' ? '' : 'none';
  if (dd.style.display !== 'none') {
    setTimeout(function() {
      document.addEventListener('click', function handler(e) {
        if (!dd.contains(e.target) && !e.target.closest('[onclick*="toggleExportDropdown"]')) {
          dd.style.display = 'none';
          document.removeEventListener('click', handler);
        }
      });
    }, 0);
  }
}
function closeExportDropdown() {
  var dd = document.getElementById('exportDropdown');
  if (dd) dd.style.display = 'none';
}
