// =====================================================
// Investigation CRUD — list, create, delete, rename, complete, reopen
// =====================================================

var _investigations = [];
var _searchQuery = '';
var _deletedUndo = null;

async function loadInvestigations() {
  _investigations = await API.getInvestigations();
  renderInvestigations();
}

function renderInvestigations() {
  var active = _investigations.filter(function(i) { return !i.completed_at; });
  var completed = _investigations.filter(function(i) { return !!i.completed_at; });

  // Apply search filter
  if (_searchQuery) {
    var q = _searchQuery.toLowerCase();
    active = active.filter(function(i) { return i.name.toLowerCase().indexOf(q) !== -1; });
    completed = completed.filter(function(i) { return i.name.toLowerCase().indexOf(q) !== -1; });
  }

  // Stats
  var allActive = _investigations.filter(function(i) { return !i.completed_at; });
  var allCompleted = _investigations.filter(function(i) { return !!i.completed_at; });
  document.getElementById('activeCount').textContent = allActive.length;
  document.getElementById('completedCount').textContent = allCompleted.length;
  var totalPins = 0;
  _investigations.forEach(function(i) { totalPins += (i.pin_count || 0); });
  document.getElementById('totalPins').textContent = totalPins;

  // Empty state
  var emptyEl = document.getElementById('emptyState');
  emptyEl.style.display = _investigations.length === 0 ? '' : 'none';

  // Active list
  var listEl = document.getElementById('invList');
  listEl.innerHTML = '';
  active.forEach(function(inv) { listEl.innerHTML += renderInvCard(inv, false); });

  // Completed section
  var compSection = document.getElementById('completedSection');
  if (allCompleted.length > 0) {
    compSection.style.display = '';
    document.getElementById('completedBadge').textContent = allCompleted.length;
    var compList = document.getElementById('completedList');
    compList.innerHTML = '';
    completed.forEach(function(inv) { compList.innerHTML += renderInvCard(inv, true); });
  } else {
    compSection.style.display = 'none';
  }
}

function renderInvCard(inv, isCompleted) {
  var dateStr = new Date(inv.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var pinCount = inv.pin_count || 0;
  var cls = isCompleted ? ' completed' : '';
  var badge = isCompleted ? '<span class="complete-badge">&#10003;</span>' : '';

  var metaHtml = '';
  if (!isCompleted && (inv.hypothesis || inv.next_step)) {
    metaHtml = '<div class="inv-card-meta">';
    if (inv.hypothesis) {
      metaHtml += '<div class="inv-card-field"><span class="inv-card-field-label">Hypothesis:</span><span class="inv-card-field-value">' + escHtml(inv.hypothesis) + '</span></div>';
    }
    if (inv.next_step) {
      metaHtml += '<div class="inv-card-field"><span class="inv-card-field-label">Next step:</span><span class="inv-card-field-value">' + escHtml(inv.next_step) + '</span></div>';
    }
    metaHtml += '</div>';
  }

  return '<div class="inv-card' + cls + '" id="card-' + inv.id + '">'
    + '<div class="inv-card-header" onclick="openReport(\'' + inv.id + '\')">'
    + '<div class="inv-card-title">' + badge + '<span class="inv-card-name" onclick="event.stopPropagation();startInlineRename(\'' + inv.id + '\',this.parentElement)">' + escHtml(inv.name) + '</span></div>'
    + '<span class="inv-card-count">' + pinCount + ' pin' + (pinCount !== 1 ? 's' : '') + '</span>'
    + '<span class="inv-card-date">' + dateStr + '</span>'
    + '<div class="inv-card-actions" onclick="event.stopPropagation()">'
    + (isCompleted
        ? '<button onclick="reopenInvestigation(\'' + inv.id + '\')" title="Reopen">&#8634;</button>'
        : '<button onclick="completeInvestigation(\'' + inv.id + '\')" title="Complete">&#10003;</button>')
    + '<button class="danger" onclick="deleteInvestigation(\'' + inv.id + '\')" title="Delete">&#128465;</button>'
    + '</div>'
    + '</div>'
    + metaHtml
    + '</div>';
}

async function createInvestigation() {
  var name = prompt('Investigation name:');
  if (!name || !name.trim()) return;
  await API.createInvestigation(name.trim());
  await loadInvestigations();
  showToast('Investigation created');
}

async function deleteInvestigation(id) {
  var inv = _investigations.find(function(i) { return i.id === id; });
  if (!inv) return;
  if (!confirm('Delete "' + inv.name + '"? This cannot be undone.')) return;
  await API.deleteInvestigation(id);
  await loadInvestigations();
  showToast('Investigation deleted');
}

function startInlineRename(id, titleEl) {
  var inv = _investigations.find(function(i) { return i.id === id; });
  if (!inv) return;

  // Don't double-activate if already editing
  if (titleEl.querySelector('input')) return;

  var currentName = inv.name;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'inline-rename-input';
  input.size = Math.max(currentName.length, 10);
  input.onclick = function(e) { e.stopPropagation(); };
  input.oninput = function() { input.size = Math.max(input.value.length, 10); };

  var committed = false;
  async function commit() {
    if (committed) return;
    committed = true;
    var newName = input.value.trim();
    if (newName && newName !== currentName) {
      await API.updateInvestigation(id, { name: newName });
    }
    await loadInvestigations();
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); committed = true; loadInvestigations(); }
  });
  input.addEventListener('blur', function() {
    setTimeout(commit, 50);
  });

  titleEl.textContent = '';
  titleEl.appendChild(input);
  requestAnimationFrame(function() {
    input.focus();
    input.select();
  });
}

async function completeInvestigation(id) {
  await API.completeInvestigation(id);
  await loadInvestigations();
  showToast('Investigation marked complete');
}

async function reopenInvestigation(id) {
  await API.reopenInvestigation(id);
  await loadInvestigations();
  showToast('Investigation reopened');
}

function filterInvestigations() {
  _searchQuery = document.getElementById('searchInput').value.trim();
  renderInvestigations();
}

function toggleCompleted() {
  var section = document.getElementById('completedSection');
  section.classList.toggle('expanded');
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
