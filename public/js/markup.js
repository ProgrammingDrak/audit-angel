// =====================================================
// Markup Artifacts — import, annotate, save, export
// =====================================================

var _markup = {
  artifact: null,
  annotations: [],
  pageMeta: { pageCount: 1 },
  tool: 'select',
  selectedId: null,
  draft: null,
  moving: null
};

function startMarkupImport() {
  if (!_currentReportId) {
    showToast('Open an investigation first');
    return;
  }
  document.getElementById('markupImportInput').click();
}

function handleMarkupImport(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('Markup files must be 5 MB or smaller');
    return;
  }

  var name = file.name || 'Markup Artifact';
  var lower = name.toLowerCase();
  var sourceType = file.type.indexOf('image/') === 0 ? 'image'
    : (file.type === 'application/pdf' || lower.endsWith('.pdf')) ? 'pdf'
    : (lower.endsWith('.html') || lower.endsWith('.htm') || file.type === 'text/html') ? 'html'
    : '';
  if (!sourceType) {
    showToast('Use an HTML, PDF, or image file');
    return;
  }

  var reader = new FileReader();
  reader.onload = async function(e) {
    var result = await API.createMarkupArtifact(_currentReportId, {
      sourceType: sourceType,
      sourceName: name,
      sourceMime: file.type || '',
      sourceContent: e.target.result,
      title: name,
      note: ''
    });
    if (!result || result.error) {
      showToast((result && result.error) || 'Could not create markup artifact');
      return;
    }
    await refreshReport();
    await loadInvestigations();
    openMarkupArtifact(result.artifact.id);
  };
  if (sourceType === 'html') reader.readAsText(file);
  else reader.readAsDataURL(file);
}

async function openMarkupPin(artifactId) {
  if (!artifactId) return;
  await openMarkupArtifact(artifactId);
}

async function openMarkupArtifact(artifactId) {
  var artifact = await API.getMarkupArtifact(artifactId);
  if (!artifact || artifact.error) {
    showToast((artifact && artifact.error) || 'Could not open markup artifact');
    return;
  }
  _markup.artifact = artifact;
  _markup.annotations = Array.isArray(artifact.annotations) ? artifact.annotations.slice() : [];
  _markup.pageMeta = artifact.page_meta || { pageCount: 1 };
  _markup.selectedId = null;
  _markup.draft = null;
  _markup.moving = null;

  document.getElementById('markupTitle').textContent = artifact.source_name || 'Markup Artifact';
  document.getElementById('markupSubtitle').textContent = (artifact.source_type || '').toUpperCase() + ' · ' + _markup.annotations.length + ' annotations';
  document.getElementById('markupOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  setMarkupTool('select');
  await renderMarkupSource();
  renderMarkupAnnotations();
  renderMarkupInspector();
}

function closeMarkupWorkspace() {
  document.getElementById('markupOverlay').classList.remove('active');
  document.body.style.overflow = document.getElementById('reportOverlay').classList.contains('active') ? 'hidden' : '';
  _markup.artifact = null;
  _markup.annotations = [];
  _markup.selectedId = null;
}

function setMarkupTool(tool) {
  _markup.tool = tool;
  document.querySelectorAll('.markup-tool').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
}

async function renderMarkupSource() {
  var stage = document.getElementById('markupStage');
  var artifact = _markup.artifact;
  stage.innerHTML = '';
  if (!artifact) return;

  if (artifact.source_type === 'html') {
    stage.innerHTML = '<div class="markup-page" data-page="0">'
      + '<iframe sandbox="" srcdoc="' + escHtml(artifact.source_content || '') + '"></iframe>'
      + markupSvgHtml(0)
      + '</div>';
    _markup.pageMeta.pageCount = 1;
    bindMarkupSvgs();
    return;
  }

  if (artifact.source_type === 'image') {
    stage.innerHTML = '<div class="markup-page" data-page="0" style="min-height:0;">'
      + '<img src="' + escHtml(artifact.source_content || '') + '" alt="' + escHtml(artifact.source_name || '') + '">'
      + markupSvgHtml(0)
      + '</div>';
    _markup.pageMeta.pageCount = 1;
    bindMarkupSvgs();
    return;
  }

  if (artifact.source_type === 'pdf') {
    if (!window.pdfjsLib) {
      stage.innerHTML = '<div style="padding:40px;text-align:center;color:#6B7280;">PDF renderer unavailable.</div>';
      return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var pdf = await pdfjsLib.getDocument(artifact.source_content).promise;
    _markup.pageMeta.pageCount = pdf.numPages;
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var viewport = page.getViewport({ scale: 1.25 });
      var pageEl = document.createElement('div');
      pageEl.className = 'markup-page';
      pageEl.dataset.page = String(i - 1);
      pageEl.style.width = viewport.width + 'px';
      pageEl.style.minHeight = viewport.height + 'px';
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pageEl.appendChild(canvas);
      pageEl.insertAdjacentHTML('beforeend', markupSvgHtml(i - 1));
      stage.appendChild(pageEl);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    }
    bindMarkupSvgs();
  }
}

function markupSvgHtml(page) {
  return '<svg class="markup-overlay-svg" data-page="' + page + '" viewBox="0 0 100 100" preserveAspectRatio="none">'
    + '<defs><marker id="markupArrowHead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path></marker></defs>'
    + '</svg>';
}

function bindMarkupSvgs() {
  document.querySelectorAll('.markup-overlay-svg').forEach(function(svg) {
    svg.onpointerdown = onMarkupPointerDown;
  });
}

function svgPoint(evt, svg) {
  var rect = svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height))
  };
}

function onMarkupPointerDown(evt) {
  var svg = evt.currentTarget;
  var hit = evt.target.closest && evt.target.closest('.markup-ann');
  if (hit) {
    selectMarkupAnnotation(hit.getAttribute('data-ann-id'));
    if (_markup.tool === 'select') {
      _markup.moving = {
        start: svgPoint(evt, svg),
        original: JSON.parse(JSON.stringify(getSelectedMarkup()))
      };
      svg.setPointerCapture(evt.pointerId);
      svg.onpointermove = onMarkupPointerMove;
      svg.onpointerup = onMarkupPointerUp;
    }
    evt.preventDefault();
    return;
  }

  if (_markup.tool === 'select') {
    selectMarkupAnnotation(null);
    return;
  }

  var page = Number(svg.dataset.page || 0);
  var p = svgPoint(evt, svg);
  var ann = {
    id: 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: _markup.tool,
    page: page,
    x: p.x,
    y: p.y,
    w: _markup.tool === 'text' ? 0.22 : 0.01,
    h: _markup.tool === 'text' ? 0.08 : 0.01,
    x2: p.x,
    y2: p.y,
    points: _markup.tool === 'pen' ? [p] : [],
    text: _markup.tool === 'text' ? 'Text note' : '',
    summary: '',
    color: document.getElementById('markupColor').value || '#DC2626',
    strokeWidth: Number(document.getElementById('markupStroke').value || 3)
  };
  _markup.annotations.push(ann);
  _markup.draft = { id: ann.id, start: p };
  selectMarkupAnnotation(ann.id);
  svg.setPointerCapture(evt.pointerId);
  svg.onpointermove = onMarkupPointerMove;
  svg.onpointerup = onMarkupPointerUp;
  renderMarkupAnnotations();
  evt.preventDefault();
}

function onMarkupPointerMove(evt) {
  var svg = evt.currentTarget;
  var p = svgPoint(evt, svg);
  if (_markup.moving) {
    moveSelectedMarkup(p);
    renderMarkupAnnotations();
    return;
  }
  if (!_markup.draft) return;
  var ann = _markup.annotations.find(function(a) { return a.id === _markup.draft.id; });
  if (!ann) return;
  if (ann.type === 'arrow') {
    ann.x2 = p.x;
    ann.y2 = p.y;
  } else if (ann.type === 'pen') {
    ann.points.push(p);
  } else {
    ann.x = Math.min(_markup.draft.start.x, p.x);
    ann.y = Math.min(_markup.draft.start.y, p.y);
    ann.w = Math.max(0.01, Math.abs(p.x - _markup.draft.start.x));
    ann.h = Math.max(0.01, Math.abs(p.y - _markup.draft.start.y));
  }
  renderMarkupAnnotations();
}

function onMarkupPointerUp(evt) {
  var svg = evt.currentTarget;
  _markup.draft = null;
  _markup.moving = null;
  svg.onpointermove = null;
  svg.onpointerup = null;
  renderMarkupInspector();
}

function moveSelectedMarkup(point) {
  var ann = getSelectedMarkup();
  if (!ann || !_markup.moving) return;
  var original = _markup.moving.original;
  var dx = point.x - _markup.moving.start.x;
  var dy = point.y - _markup.moving.start.y;
  ann.x = clamp01((original.x || 0) + dx);
  ann.y = clamp01((original.y || 0) + dy);
  if (original.x2 !== undefined) ann.x2 = clamp01((original.x2 || 0) + dx);
  if (original.y2 !== undefined) ann.y2 = clamp01((original.y2 || 0) + dy);
  if (Array.isArray(original.points)) {
    ann.points = original.points.map(function(pt) { return { x: clamp01((pt.x || 0) + dx), y: clamp01((pt.y || 0) + dy) }; });
  }
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function renderMarkupAnnotations() {
  document.querySelectorAll('.markup-overlay-svg').forEach(function(svg) {
    var page = Number(svg.dataset.page || 0);
    var defs = svg.querySelector('defs');
    svg.innerHTML = '';
    if (defs) svg.appendChild(defs);
    _markup.annotations.filter(function(ann) { return Number(ann.page || 0) === page; }).forEach(function(ann) {
      svg.appendChild(createMarkupSvgNode(ann));
    });
  });
  document.getElementById('markupSubtitle').textContent = (_markup.artifact.source_type || '').toUpperCase() + ' · ' + _markup.annotations.length + ' annotations';
  renderMarkupInspector();
}

function createMarkupSvgNode(ann) {
  var ns = 'http://www.w3.org/2000/svg';
  var node;
  var color = ann.color || '#DC2626';
  var stroke = Math.max(0.25, Number(ann.strokeWidth || 3) / 2);
  if (ann.type === 'arrow') {
    node = document.createElementNS(ns, 'line');
    node.setAttribute('x1', (ann.x || 0) * 100);
    node.setAttribute('y1', (ann.y || 0) * 100);
    node.setAttribute('x2', (ann.x2 || ann.x || 0) * 100);
    node.setAttribute('y2', (ann.y2 || ann.y || 0) * 100);
    node.setAttribute('marker-end', 'url(#markupArrowHead)');
  } else if (ann.type === 'pen') {
    node = document.createElementNS(ns, 'path');
    var d = (ann.points || []).map(function(pt, idx) {
      return (idx ? 'L ' : 'M ') + ((pt.x || 0) * 100) + ' ' + ((pt.y || 0) * 100);
    }).join(' ');
    node.setAttribute('d', d);
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
  } else if (ann.type === 'text') {
    node = document.createElementNS(ns, 'foreignObject');
    node.setAttribute('x', (ann.x || 0) * 100);
    node.setAttribute('y', (ann.y || 0) * 100);
    node.setAttribute('width', Math.max((ann.w || 0.2) * 100, 10));
    node.setAttribute('height', Math.max((ann.h || 0.08) * 100, 6));
    var div = document.createElement('div');
    div.className = 'markup-ann-text';
    div.style.color = color;
    div.textContent = ann.text || ann.summary || 'Text note';
    node.appendChild(div);
  } else {
    node = document.createElementNS(ns, 'rect');
    node.setAttribute('x', (ann.x || 0) * 100);
    node.setAttribute('y', (ann.y || 0) * 100);
    node.setAttribute('width', Math.max((ann.w || 0.01) * 100, 0.7));
    node.setAttribute('height', Math.max((ann.h || 0.01) * 100, 0.7));
    node.setAttribute('rx', 1);
    if (ann.type === 'highlight') {
      node.setAttribute('fill', color);
      node.setAttribute('fill-opacity', '0.22');
    } else {
      node.setAttribute('fill', 'none');
    }
  }
  node.setAttribute('stroke', color);
  node.setAttribute('stroke-width', stroke);
  node.setAttribute('class', 'markup-ann' + (ann.id === _markup.selectedId ? ' selected' : ''));
  node.setAttribute('data-ann-id', ann.id);
  node.style.color = color;
  return node;
}

function renderMarkupInspector() {
  var list = document.getElementById('markupAnnotationList');
  if (!_markup.annotations.length) {
    list.innerHTML = '<div style="font-size:12px;color:#6B7280;padding:18px 4px;">No annotations yet.</div>';
  } else {
    list.innerHTML = _markup.annotations.map(function(ann, idx) {
      var active = ann.id === _markup.selectedId ? ' active' : '';
      var label = ann.summary || ann.text || '(No summary yet)';
      return '<div class="markup-ann-item' + active + '" onclick="selectMarkupAnnotation(\'' + ann.id + '\',true)">'
        + '<div class="markup-ann-item-meta">' + (idx + 1) + ' · ' + escHtml(ann.type) + ' · Page ' + (Number(ann.page || 0) + 1) + '</div>'
        + '<div class="markup-ann-item-text">' + escHtml(label) + '</div>'
        + '</div>';
    }).join('');
  }

  var ann = getSelectedMarkup();
  document.getElementById('markupEditor').style.display = ann ? '' : 'none';
  if (ann) {
    document.getElementById('markupTextInput').value = ann.text || '';
    document.getElementById('markupSummaryInput').value = ann.summary || '';
    document.getElementById('markupColor').value = ann.color || '#DC2626';
    document.getElementById('markupStroke').value = ann.strokeWidth || 3;
  }
}

function selectMarkupAnnotation(id, scrollToIt) {
  _markup.selectedId = id;
  renderMarkupAnnotations();
  if (scrollToIt && id) {
    var node = document.querySelector('.markup-ann[data-ann-id="' + id + '"]');
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function getSelectedMarkup() {
  return _markup.annotations.find(function(ann) { return ann.id === _markup.selectedId; }) || null;
}

function updateSelectedMarkupText() {
  var ann = getSelectedMarkup();
  if (!ann) return;
  ann.text = document.getElementById('markupTextInput').value;
  renderMarkupAnnotations();
}

function updateSelectedMarkupSummary() {
  var ann = getSelectedMarkup();
  if (!ann) return;
  ann.summary = document.getElementById('markupSummaryInput').value;
  renderMarkupInspector();
}

function updateSelectedMarkupStyle() {
  var ann = getSelectedMarkup();
  if (!ann) return;
  ann.color = document.getElementById('markupColor').value;
  ann.strokeWidth = Number(document.getElementById('markupStroke').value || 3);
  renderMarkupAnnotations();
}

function deleteSelectedMarkup() {
  if (!_markup.selectedId) return;
  _markup.annotations = _markup.annotations.filter(function(ann) { return ann.id !== _markup.selectedId; });
  _markup.selectedId = null;
  renderMarkupAnnotations();
}

async function saveCurrentMarkup() {
  if (!_markup.artifact) return;
  var saveBtn = document.getElementById('markupSaveBtn');
  var originalText = saveBtn ? saveBtn.textContent : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  try {
    var updated = await API.updateMarkupArtifact(_markup.artifact.id, {
      annotations: _markup.annotations,
      page_meta: _markup.pageMeta
    });
    if (!updated || updated.error) {
      showToast((updated && updated.error) || 'Could not save markup');
      return;
    }
    _markup.artifact = updated;
    var invId = updated.investigation_id || _currentReportId;
    var pinId = updated.pin_id;

    if (_currentReportId) {
      await refreshReport();
      switchReportTab('notes');
    } else if (invId) {
      await openReport(invId);
    }

    closeMarkupWorkspace();
    showToast('Markup saved');
    focusMarkupActivityPin(pinId);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText || 'Save';
    }
  }
}

function focusMarkupActivityPin(pinId) {
  if (!pinId) return;
  setTimeout(function() {
    var pin = document.getElementById('pin-' + pinId);
    if (!pin) return;
    pin.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pin.classList.add('pin-save-focus');
    setTimeout(function() { pin.classList.remove('pin-save-focus'); }, 1600);
  }, 100);
}

function exportCurrentMarkup() {
  if (!_markup.artifact) return;
  var missing = _markup.annotations.filter(function(ann) { return !(ann.summary || '').trim(); }).length;
  if (missing && !confirm(missing + ' annotation' + (missing === 1 ? ' has' : 's have') + ' no summary comment. Export anyway?')) return;
  window.location.href = API.exportMarkupArtifactUrl(_markup.artifact.id);
}
