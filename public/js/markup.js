// =====================================================
// Markup Artifacts — import, annotate, save, export
// =====================================================

var _markup = {
  artifact: null,
  annotations: [],
  pageMeta: { pageCount: 1 },
  tool: 'select',
  shape: 'rect',
  selectedId: null,
  draft: null,
  moving: null,
  importMode: 'investigation',
  undoStack: [],
  redoStack: [],
  historyLimit: 80,
  historyEditKey: null
};

function startMarkupImport() {
  if (!_currentReportId) {
    startStandaloneMarkupImport();
    return;
  }
  _markup.importMode = 'investigation';
  document.getElementById('markupImportInput').click();
}

function startStandaloneMarkupImport() {
  _markup.importMode = 'standalone';
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
    var payload = {
      sourceType: sourceType,
      sourceName: name,
      sourceMime: file.type || '',
      sourceContent: e.target.result,
      title: name,
      note: ''
    };
    var result = _markup.importMode === 'standalone'
      ? await API.createStandaloneMarkupArtifact(payload)
      : await API.createMarkupArtifact(_currentReportId, payload);
    if (!result || result.error) {
      showToast((result && result.error) || 'Could not create markup artifact');
      return;
    }
    if (_markup.importMode !== 'standalone') await refreshReport();
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
  resetMarkupHistory();

  document.getElementById('markupTitle').textContent = artifact.source_name || 'Markup Artifact';
  document.getElementById('markupSubtitle').textContent = (artifact.source_type || '').toUpperCase() + ' · ' + _markup.annotations.length + ' annotations';
  document.getElementById('markupOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  setMarkupTool('select');
  renderMarkupAttachActions();
  renderMarkupShareActions();
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
  resetMarkupHistory();
  renderMarkupAttachActions();
  renderMarkupShareActions();
}

function setMarkupTool(tool) {
  _markup.tool = tool;
  var shapeSelect = document.getElementById('markupShape');
  if (shapeSelect) _markup.shape = shapeSelect.value || _markup.shape || 'rect';
  document.querySelectorAll('.markup-tool').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  updateMarkupSvgInteraction();
}

function updateMarkupShapeTool() {
  var shapeSelect = document.getElementById('markupShape');
  _markup.shape = shapeSelect ? shapeSelect.value : 'rect';
  var ann = getSelectedMarkup();
  if (ann && (ann.type === 'shape' || ann.type === 'marker')) {
    pushMarkupHistory();
    ann.type = 'shape';
    ann.shape = _markup.shape;
    renderMarkupAnnotations();
  }
  setMarkupTool('shape');
}

async function renderMarkupSource() {
  var stage = document.getElementById('markupStage');
  var artifact = _markup.artifact;
  stage.innerHTML = '';
  if (!artifact) return;

  if (artifact.source_type === 'html') {
    stage.innerHTML = '<div class="markup-page" data-page="0">'
      + '<iframe sandbox="allow-same-origin" scrolling="no" onload="resizeMarkupHtmlFrame(this)" srcdoc="' + escHtml(artifact.source_content || '') + '"></iframe>'
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
  updateMarkupSvgInteraction();
}

function updateMarkupSvgInteraction() {
  document.querySelectorAll('.markup-overlay-svg').forEach(function(svg) {
    svg.classList.toggle('markup-drawing-surface', _markup.tool !== 'select');
  });
}

function resizeMarkupHtmlFrame(iframe) {
  if (!iframe) return;
  var resize = function() {
    try {
      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (!doc) return;
      var body = doc.body;
      var root = doc.documentElement;
      var height = Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root ? root.scrollHeight : 0,
        root ? root.offsetHeight : 0,
        760
      );
      iframe.style.height = height + 'px';
      if (iframe.parentElement) iframe.parentElement.style.minHeight = height + 'px';
    } catch (err) {
      iframe.style.height = '1200px';
      if (iframe.parentElement) iframe.parentElement.style.minHeight = '1200px';
    }
  };
  resize();
  setTimeout(resize, 100);
  setTimeout(resize, 500);
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
        original: JSON.parse(JSON.stringify(getSelectedMarkup())),
        historyRecorded: false
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
  var color = document.getElementById('markupColor').value || '#DC2626';
  var strokeWidth = Number(document.getElementById('markupStroke').value || 2);
  var annotationType = _markup.tool === 'shape' ? 'shape' : _markup.tool;
  var ann = {
    id: 'ann_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: annotationType,
    shape: annotationType === 'shape' ? (_markup.shape || 'rect') : undefined,
    page: page,
    x: p.x,
    y: p.y,
    w: _markup.tool === 'text' ? 0.14 : 0.01,
    h: _markup.tool === 'text' ? 0.045 : 0.01,
    x2: p.x,
    y2: p.y,
    points: _markup.tool === 'pen' ? [p] : [],
    text: _markup.tool === 'text' ? 'Text note' : '',
    summary: '',
    color: color,
    strokeWidth: strokeWidth
  };
  pushMarkupHistory();
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
    if (!_markup.moving.historyRecorded) {
      pushMarkupHistory();
      _markup.moving.historyRecorded = true;
    }
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
  _markup.historyEditKey = null;
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
  renderMarkupAttachActions();
  renderMarkupShareActions();
  renderMarkupInspector();
}

function createMarkupSvgNode(ann) {
  var ns = 'http://www.w3.org/2000/svg';
  var group = document.createElementNS(ns, 'g');
  var node;
  var color = ann.color || '#DC2626';
  var stroke = Math.max(1, Number(ann.strokeWidth || 2));
  var x = (ann.x || 0) * 100;
  var y = (ann.y || 0) * 100;
  var w = Math.max((ann.w || 0.01) * 100, 0.7);
  var h = Math.max((ann.h || 0.01) * 100, 0.7);
  if (ann.type === 'arrow') {
    node = document.createElementNS(ns, 'line');
    node.setAttribute('x1', x);
    node.setAttribute('y1', y);
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
    node.setAttribute('x', x);
    node.setAttribute('y', y);
    node.setAttribute('width', Math.max((ann.w || 0.2) * 100, 10));
    node.setAttribute('height', Math.max((ann.h || 0.08) * 100, 6));
    var div = document.createElement('div');
    div.className = 'markup-ann-text';
    div.style.color = color;
    div.textContent = ann.text || ann.summary || 'Text note';
    node.appendChild(div);
  } else if (ann.type === 'shape' || ann.type === 'marker') {
    node = createShapeNode(ns, ann.shape || 'rect', x, y, w, h);
    node.setAttribute('fill', 'none');
  } else {
    node = document.createElementNS(ns, 'rect');
    node.setAttribute('x', x);
    node.setAttribute('y', y);
    node.setAttribute('width', w);
    node.setAttribute('height', h);
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
  if (ann.type !== 'text') node.setAttribute('vector-effect', 'non-scaling-stroke');
  group.setAttribute('class', 'markup-ann' + (ann.id === _markup.selectedId ? ' selected' : ''));
  group.setAttribute('data-ann-id', ann.id);
  node.style.color = color;
  group.style.color = color;
  group.appendChild(node);
  appendMarkupVisibleTextLabel(group, ann, color);
  return group;
}

function appendMarkupVisibleTextLabel(group, ann, color) {
  var label = (ann.text || '').trim();
  if (!label || ann.type === 'text') return;
  var ns = 'http://www.w3.org/2000/svg';
  var bounds = getMarkupAnnotationBounds(ann);
  var labelW = Math.max(12, Math.min(36, 5 + (label.length * 0.52)));
  var labelH = 4.8;
  var labelX = Math.min(100 - labelW - 1, Math.max(1, bounds.right + 1.1));
  var labelY = Math.max(1, bounds.top - labelH - 0.9);
  if (labelY <= 1.1 && bounds.bottom + labelH + 1 <= 99) labelY = bounds.bottom + 0.9;
  if (labelX < bounds.right && bounds.left - labelW - 1.1 >= 1) labelX = bounds.left - labelW - 1.1;

  var foreignObject = document.createElementNS(ns, 'foreignObject');
  foreignObject.setAttribute('x', labelX);
  foreignObject.setAttribute('y', Math.min(100 - labelH - 1, labelY));
  foreignObject.setAttribute('width', labelW);
  foreignObject.setAttribute('height', labelH);
  var div = document.createElement('div');
  div.className = 'markup-ann-label';
  div.style.borderColor = color;
  div.style.color = color;
  div.textContent = label;
  foreignObject.appendChild(div);
  group.appendChild(foreignObject);
}

function getMarkupAnnotationBounds(ann) {
  var xs = [(ann.x || 0) * 100];
  var ys = [(ann.y || 0) * 100];
  if (ann.x2 !== undefined) xs.push((ann.x2 || 0) * 100);
  if (ann.y2 !== undefined) ys.push((ann.y2 || 0) * 100);
  if (ann.w !== undefined) xs.push(((ann.x || 0) + Math.max(ann.w || 0.01, 0.01)) * 100);
  if (ann.h !== undefined) ys.push(((ann.y || 0) + Math.max(ann.h || 0.01, 0.01)) * 100);
  if (Array.isArray(ann.points) && ann.points.length) {
    ann.points.forEach(function(pt) {
      xs.push((pt.x || 0) * 100);
      ys.push((pt.y || 0) * 100);
    });
  }
  return {
    left: Math.max(0, Math.min.apply(null, xs)),
    right: Math.min(100, Math.max.apply(null, xs)),
    top: Math.max(0, Math.min.apply(null, ys)),
    bottom: Math.min(100, Math.max.apply(null, ys))
  };
}

function createShapeNode(ns, shape, x, y, w, h) {
  if (shape === 'ellipse') {
    var ellipse = document.createElementNS(ns, 'ellipse');
    ellipse.setAttribute('cx', x + w / 2);
    ellipse.setAttribute('cy', y + h / 2);
    ellipse.setAttribute('rx', w / 2);
    ellipse.setAttribute('ry', h / 2);
    return ellipse;
  }
  if (shape === 'diamond' || shape === 'triangle') {
    var polygon = document.createElementNS(ns, 'polygon');
    var points = shape === 'diamond'
      ? [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h]]
      : [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    polygon.setAttribute('points', points.map(function(p) { return p[0] + ',' + p[1]; }).join(' '));
    return polygon;
  }
  var rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', w);
  rect.setAttribute('height', h);
  rect.setAttribute('rx', shape === 'round' ? 2 : 0.5);
  return rect;
}

function renderMarkupInspector() {
  var list = document.getElementById('markupAnnotationList');
  if (!_markup.annotations.length) {
    list.innerHTML = '<div style="font-size:12px;color:#6B7280;padding:18px 4px;">No annotations yet.</div>';
  } else {
    list.innerHTML = _markup.annotations.map(function(ann, idx) {
      var active = ann.id === _markup.selectedId ? ' active' : '';
      var label = ann.summary || ann.text || '(No summary yet)';
      var typeLabel = getMarkupAnnotationLabel(ann);
      return '<div class="markup-ann-item' + active + '" onclick="selectMarkupAnnotation(\'' + ann.id + '\',true)">'
        + '<div class="markup-ann-item-meta">' + (idx + 1) + ' · ' + escHtml(typeLabel) + ' · Page ' + (Number(ann.page || 0) + 1) + '</div>'
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
    document.getElementById('markupStroke').value = ann.strokeWidth || 2;
    var shapeSelect = document.getElementById('markupShape');
    if (shapeSelect && (ann.type === 'shape' || ann.type === 'marker')) shapeSelect.value = ann.shape || 'rect';
  }
}

function getMarkupAnnotationLabel(ann) {
  if (!ann) return 'Annotation';
  if (ann.type !== 'shape' && ann.type !== 'marker') return ann.type || 'Annotation';
  var names = {
    rect: 'Rectangle',
    round: 'Rounded',
    ellipse: 'Oval',
    diamond: 'Diamond',
    triangle: 'Triangle'
  };
  return names[ann.shape || 'rect'] || 'Shape';
}

function selectMarkupAnnotation(id, scrollToIt) {
  _markup.historyEditKey = null;
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
  pushMarkupHistory();
  ann.color = document.getElementById('markupColor').value;
  ann.strokeWidth = Number(document.getElementById('markupStroke').value || 2);
  renderMarkupAnnotations();
}

function deleteSelectedMarkup() {
  if (!_markup.selectedId) return;
  pushMarkupHistory();
  _markup.annotations = _markup.annotations.filter(function(ann) { return ann.id !== _markup.selectedId; });
  _markup.selectedId = null;
  renderMarkupAnnotations();
}

function prepareSelectedMarkupEdit(field) {
  var ann = getSelectedMarkup();
  if (!ann) return;
  var key = field + ':' + ann.id;
  if (_markup.historyEditKey === key) return;
  pushMarkupHistory();
  _markup.historyEditKey = key;
}

function finishMarkupHistoryEdit() {
  _markup.historyEditKey = null;
}

function cloneMarkupValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getMarkupHistorySnapshot() {
  return {
    annotations: cloneMarkupValue(_markup.annotations || []),
    pageMeta: cloneMarkupValue(_markup.pageMeta || { pageCount: 1 }),
    selectedId: _markup.selectedId,
    shape: _markup.shape || 'rect'
  };
}

function sameMarkupHistorySnapshot(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resetMarkupHistory() {
  _markup.undoStack = [];
  _markup.redoStack = [];
  _markup.historyEditKey = null;
  updateMarkupHistoryControls();
}

function pushMarkupHistory() {
  if (!_markup.artifact) return;
  var snapshot = getMarkupHistorySnapshot();
  var last = _markup.undoStack[_markup.undoStack.length - 1];
  if (last && sameMarkupHistorySnapshot(last, snapshot)) return;
  _markup.undoStack.push(snapshot);
  if (_markup.undoStack.length > _markup.historyLimit) _markup.undoStack.shift();
  _markup.redoStack = [];
  updateMarkupHistoryControls();
}

function restoreMarkupHistorySnapshot(snapshot) {
  _markup.annotations = cloneMarkupValue(snapshot.annotations || []);
  _markup.pageMeta = cloneMarkupValue(snapshot.pageMeta || { pageCount: 1 });
  _markup.selectedId = snapshot.selectedId || null;
  _markup.shape = snapshot.shape || _markup.shape || 'rect';
  _markup.draft = null;
  _markup.moving = null;
  _markup.historyEditKey = null;
  renderMarkupAnnotations();
  updateMarkupHistoryControls();
}

function undoCurrentMarkup() {
  if (!_markup.undoStack.length) return;
  var current = getMarkupHistorySnapshot();
  var previous = _markup.undoStack.pop();
  if (!sameMarkupHistorySnapshot(current, previous)) {
    _markup.redoStack.push(current);
  }
  restoreMarkupHistorySnapshot(previous);
}

function redoCurrentMarkup() {
  if (!_markup.redoStack.length) return;
  var current = getMarkupHistorySnapshot();
  var next = _markup.redoStack.pop();
  if (!sameMarkupHistorySnapshot(current, next)) {
    _markup.undoStack.push(current);
  }
  restoreMarkupHistorySnapshot(next);
}

function updateMarkupHistoryControls() {
  var undoBtn = document.getElementById('markupUndoBtn');
  var redoBtn = document.getElementById('markupRedoBtn');
  if (undoBtn) undoBtn.disabled = !_markup.undoStack.length;
  if (redoBtn) redoBtn.disabled = !_markup.redoStack.length;
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
    var updated = await persistCurrentMarkup();
    if (!updated || updated.error) {
      showToast((updated && updated.error) || 'Could not save markup');
      return;
    }
    if (!updated.pin_id && !updated.investigation_id) {
      await loadInvestigations();
      showToast('Standalone markup saved');
      renderMarkupAttachActions();
      return;
    }

    var invId = updated.investigation_id || _currentReportId;
    var pinId = updated.pin_id;
    var reportReady = false;

    try {
      if (_currentReportId) {
        await refreshReport();
        switchReportTab('notes');
        reportReady = true;
      } else if (invId) {
        await openReport(invId);
        reportReady = true;
      }
    } catch (err) {
      console.error('Saved markup, but could not reload report', err);
    }

    closeMarkupWorkspace();
    showToast(reportReady ? 'Markup saved' : 'Markup saved. Refresh the report to see the latest pin.');
    if (reportReady) focusMarkupActivityPin(pinId);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText || 'Save';
    }
  }
}

async function persistCurrentMarkup() {
  if (!_markup.artifact) return null;
  var updated = await API.updateMarkupArtifact(_markup.artifact.id, {
    annotations: _markup.annotations,
    page_meta: _markup.pageMeta
  });
  if (updated && !updated.error) {
    _markup.artifact = updated;
  }
  return updated;
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

function renderMarkupAttachActions() {
  var wrap = document.getElementById('markupAttachActions');
  var select = document.getElementById('markupAttachSelect');
  if (!wrap || !select) return;
  var artifact = _markup.artifact;
  var isStandalone = artifact && !artifact.pin_id && !artifact.investigation_id;
  wrap.style.display = isStandalone ? '' : 'none';
  if (!isStandalone) return;

  var options = _investigations.map(function(inv) {
    return '<option value="' + escHtml(inv.id) + '">' + escHtml(inv.name) + (inv.completed_at ? ' (completed)' : '') + '</option>';
  }).join('');
  if (!options) options = '<option value="">No investigations</option>';
  select.innerHTML = options;
  select.disabled = _investigations.length === 0;
}

function getMarkupShareInfo(artifact) {
  if (!artifact) return null;
  if (artifact.share) return artifact.share;
  if (!artifact.share_id) return null;
  return {
    id: artifact.share_id,
    status: artifact.share_status || 'open',
    reviewerName: artifact.share_reviewer_name || '',
    reviewerEmail: artifact.share_reviewer_email || '',
    lastReviewerSeenAt: artifact.share_last_reviewer_seen_at || null,
    lastReviewerSavedAt: artifact.share_last_reviewer_saved_at || null,
    createdAt: artifact.share_created_at || null,
    closedAt: artifact.share_closed_at || null
  };
}

function applyMarkupShareInfo(artifact, share) {
  if (!artifact || !share) return;
  artifact.share = share;
  artifact.share_id = share.id;
  artifact.share_status = share.status;
  artifact.share_reviewer_name = share.reviewerName || '';
  artifact.share_reviewer_email = share.reviewerEmail || '';
  artifact.share_last_reviewer_seen_at = share.lastReviewerSeenAt || null;
  artifact.share_last_reviewer_saved_at = share.lastReviewerSavedAt || null;
  artifact.share_created_at = share.createdAt || null;
  artifact.share_closed_at = share.closedAt || null;
}

function renderMarkupShareActions() {
  var shareBtn = document.getElementById('markupShareBtn');
  var statusBtn = document.getElementById('markupShareStatusBtn');
  if (!shareBtn && !statusBtn) return;
  var artifact = _markup.artifact;
  if (shareBtn) shareBtn.style.display = artifact ? '' : 'none';
  if (!statusBtn) return;
  var share = getMarkupShareInfo(artifact);
  statusBtn.style.display = share ? '' : 'none';
  if (share) {
    statusBtn.textContent = share.status === 'closed' ? 'Reopen Request' : 'Close Request';
    statusBtn.classList.toggle('btn-danger', share.status !== 'closed');
    statusBtn.classList.toggle('btn-light', share.status === 'closed');
  }
}

async function copyMarkupShareText(message) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(message);
      return true;
    } catch (err) {}
  }
  prompt('Copy this share message:', message);
  return false;
}

async function shareMarkupArtifactById(artifactId) {
  var result = await API.createMarkupShare(artifactId);
  if (!result || result.error) {
    showToast((result && result.error) || 'Could not create share link');
    return;
  }
  if (_markup.artifact && _markup.artifact.id === artifactId) {
    applyMarkupShareInfo(_markup.artifact, result.share);
    renderMarkupShareActions();
  }
  if (typeof _standaloneMarkups !== 'undefined') {
    var artifact = _standaloneMarkups.find(function(a) { return a.id === artifactId; });
    applyMarkupShareInfo(artifact, result.share);
    if (typeof renderInvestigations === 'function') renderInvestigations();
  }
  await copyMarkupShareText(result.message || result.shareUrl);
  showToast('Share link copied');
}

async function shareCurrentMarkup() {
  if (!_markup.artifact) return;
  await shareMarkupArtifactById(_markup.artifact.id);
}

async function updateMarkupShareStatusForArtifact(artifactId, shareId, status) {
  var result = await API.updateMarkupShare(shareId, { status: status });
  if (!result || result.error) {
    showToast((result && result.error) || 'Could not update share request');
    return;
  }
  if (_markup.artifact && _markup.artifact.id === artifactId) {
    applyMarkupShareInfo(_markup.artifact, result.share);
    renderMarkupShareActions();
  }
  if (typeof _standaloneMarkups !== 'undefined') {
    var artifact = _standaloneMarkups.find(function(a) { return a.id === artifactId; });
    applyMarkupShareInfo(artifact, result.share);
    if (typeof renderInvestigations === 'function') renderInvestigations();
  }
  showToast(status === 'closed' ? 'Markup request closed' : 'Markup request reopened');
}

async function toggleCurrentMarkupShareStatus() {
  var artifact = _markup.artifact;
  var share = getMarkupShareInfo(artifact);
  if (!artifact || !share) return;
  var nextStatus = share.status === 'closed' ? 'open' : 'closed';
  await updateMarkupShareStatusForArtifact(artifact.id, share.id, nextStatus);
}

async function toggleStandaloneMarkupShareStatus(artifactId) {
  var artifact = _standaloneMarkups.find(function(a) { return a.id === artifactId; });
  var share = getMarkupShareInfo(artifact);
  if (!artifact || !share) return;
  var nextStatus = share.status === 'closed' ? 'open' : 'closed';
  await updateMarkupShareStatusForArtifact(artifact.id, share.id, nextStatus);
}

async function attachSelectedMarkupInvestigation() {
  var select = document.getElementById('markupAttachSelect');
  var invId = select && select.value;
  if (!invId) {
    showToast('Create an investigation first, or start a new one from this markup');
    return;
  }
  await attachCurrentMarkupToInvestigation(invId);
}

async function attachCurrentMarkupToInvestigation(invId) {
  if (!_markup.artifact) return;
  var saved = await persistCurrentMarkup();
  if (!saved || saved.error) {
    showToast((saved && saved.error) || 'Could not save markup before attaching');
    return;
  }
  await attachMarkupArtifactToInvestigation(saved.id, invId);
}

async function attachStandaloneMarkupToSelected(artifactId) {
  var select = document.getElementById('standaloneAttachSelect-' + artifactId);
  var invId = select && select.value;
  if (!invId) {
    showToast('Choose an investigation first');
    return;
  }
  await attachMarkupArtifactToInvestigation(artifactId, invId);
}

async function attachMarkupArtifactToInvestigation(artifactId, invId) {
  var result = await API.attachMarkupArtifact(artifactId, { investigationId: invId });
  if (!result || result.error) {
    showToast((result && result.error) || 'Could not attach markup');
    return;
  }
  await loadInvestigations();
  await openReport(invId);
  closeMarkupWorkspace();
  showToast('Markup attached');
  focusMarkupActivityPin(result.pin && result.pin.id);
}

async function createInvestigationFromCurrentMarkup() {
  if (!_markup.artifact) return;
  var saved = await persistCurrentMarkup();
  if (!saved || saved.error) {
    showToast((saved && saved.error) || 'Could not save markup before attaching');
    return;
  }
  await createInvestigationFromMarkupArtifact(saved.id, saved.source_name || 'Markup Investigation');
}

async function createInvestigationFromStandaloneMarkup(artifactId) {
  var artifact = (_standaloneMarkups || []).find(function(a) { return a.id === artifactId; });
  await createInvestigationFromMarkupArtifact(artifactId, (artifact && artifact.source_name) || 'Markup Investigation');
}

async function createInvestigationFromMarkupArtifact(artifactId, defaultName) {
  var name = prompt('New investigation name:', defaultName || 'Markup Investigation');
  if (!name || !name.trim()) return;
  var result = await API.attachMarkupArtifact(artifactId, { createInvestigationName: name.trim() });
  if (!result || result.error) {
    showToast((result && result.error) || 'Could not create investigation from markup');
    return;
  }
  await loadInvestigations();
  var invId = (result.investigation && result.investigation.id) || (result.artifact && result.artifact.investigation_id);
  if (invId) await openReport(invId);
  closeMarkupWorkspace();
  showToast('Investigation created from markup');
  focusMarkupActivityPin(result.pin && result.pin.id);
}

function exportCurrentMarkup() {
  if (!_markup.artifact) return;
  var missing = _markup.annotations.filter(function(ann) { return !(ann.summary || '').trim(); }).length;
  if (missing && !confirm(missing + ' annotation' + (missing === 1 ? ' has' : 's have') + ' no summary comment. Export anyway?')) return;
  window.location.href = API.exportMarkupArtifactUrl(_markup.artifact.id);
}
