// =====================================================
// Capture System — image paste/drop, manual notes
// =====================================================

var _noteImages = [];
var _noteColor = null;

function showAddNoteForm() {
  _noteImages = [];
  _noteColor = null;
  document.getElementById('addNoteFormWrap').style.display = '';
  document.getElementById('noteDropZone').style.display = 'none';
  document.getElementById('noteTextInput').value = '';
  document.getElementById('noteImageGallery').innerHTML = '';
  document.getElementById('noteImageGallery').style.display = 'none';
  renderNoteColorSwatches();
  // Markdown toolbar + smart paste
  var toolbar = document.getElementById('noteToolbar');
  if (toolbar) toolbar.innerHTML = renderMarkdownToolbar('noteTextInput');
  var ta = document.getElementById('noteTextInput');
  if (ta) setupSmartLinkPaste(ta);
  ta.focus();
}

function toggleDropZone() {
  var dz = document.getElementById('noteDropZone');
  dz.style.display = dz.style.display === 'none' ? '' : 'none';
}

function hideAddNoteForm() {
  document.getElementById('addNoteFormWrap').style.display = 'none';
  _noteImages = [];
  _noteColor = null;
}

async function saveManualNote() {
  if (!_currentReportId) return;
  var text = document.getElementById('noteTextInput').value.trim();
  if (!text && _noteImages.length === 0) {
    showToast('Add a note or image first');
    return;
  }

  var pin = {
    type: _noteImages.length > 0 ? 'screenshot' : 'note',
    source: 'Manual',
    title: text ? text.substring(0, 60) + (text.length > 60 ? '...' : '') : 'Screenshot',
    note: text,
    color: _noteColor,
    images: _noteImages.map(function(img) {
      return { data_url: img.dataUrl, caption: img.caption || '', link: '' };
    })
  };

  await API.addPin(_currentReportId, pin);
  // Clear form for next note instead of hiding
  document.getElementById('noteTextInput').value = '';
  _noteImages = [];
  _noteColor = null;
  document.getElementById('noteImageGallery').innerHTML = '';
  document.getElementById('noteImageGallery').style.display = 'none';
  document.getElementById('noteDropZone').style.display = 'none';
  renderNoteColorSwatches();
  await refreshReport();
  await loadInvestigations();
  showToast('Note added');
}

function renderNoteColorSwatches() {
  var container = document.getElementById('noteColorSwatches');
  if (!container) return;
  var colors = getAllPinColors();
  var html = '';
  colors.forEach(function(c) {
    var active = _noteColor === c.value ? ' active' : '';
    var cls = !c.custom ? ' sw-' + c.value : '';
    var style = c.custom ? ' style="background:' + c.hex + ';"' : '';
    html += '<span class="color-swatch' + cls + active + '"' + style + ' onclick="setNoteColor(\'' + c.value + '\')" title="' + c.label + '"></span>';
  });
  var noneActive = !_noteColor ? ' active' : '';
  html += '<span class="color-swatch sw-none' + noneActive + '" onclick="setNoteColor(null)" title="None"></span>';
  html += '<span class="color-swatch" style="background:none;border:1px dashed var(--border);font-size:9px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);cursor:pointer;" onclick="showAddColorPopover(this,function(){renderNoteColorSwatches();})" title="Add custom color">+</span>';
  container.innerHTML = html;
}

function setNoteColor(color) {
  _noteColor = color;
  renderNoteColorSwatches();
}

// Image paste/drop handlers
function initCaptureHandlers() {
  var dropZone = document.getElementById('noteDropZone');
  if (!dropZone) return;

  dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', function() {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
  dropZone.addEventListener('click', function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function() { handleFiles(input.files); };
    input.click();
  });

  var formWrap = document.getElementById('addNoteFormWrap');
  formWrap.addEventListener('dragover', function(e) {
    e.preventDefault();
    var dz = document.getElementById('noteDropZone');
    if (dz.style.display === 'none') dz.style.display = '';
  });

  formWrap.addEventListener('paste', function(e) {
    var items = e.clipboardData.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        var file = items[i].getAsFile();
        handleFiles([file]);
        break;
      }
    }
  });
}

function handleFiles(files) {
  for (var i = 0; i < files.length; i++) {
    if (!files[i].type.startsWith('image/')) continue;
    var reader = new FileReader();
    reader.onload = function(e) {
      compressImage(e.target.result, function(compressed) {
        _noteImages.push({ dataUrl: compressed, caption: '' });
        renderNoteImageGallery();
      });
    };
    reader.readAsDataURL(files[i]);
  }
}

function compressImage(dataUrl, callback) {
  var img = new Image();
  img.onload = function() {
    var canvas = document.createElement('canvas');
    var maxW = 1200;
    var scale = Math.min(1, maxW / img.width);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    callback(canvas.toDataURL('image/jpeg', 0.7));
  };
  img.src = dataUrl;
}

function renderNoteImageGallery() {
  var gallery = document.getElementById('noteImageGallery');
  if (_noteImages.length === 0) {
    gallery.style.display = 'none';
    gallery.innerHTML = '';
    return;
  }
  gallery.style.display = 'flex';
  var html = '';
  _noteImages.forEach(function(img, idx) {
    html += '<div style="position:relative;width:100px;height:100px;border-radius:8px;overflow:hidden;border:1px solid #E5E7EB;">'
      + '<img src="' + img.dataUrl + '" style="width:100%;height:100%;object-fit:cover;">'
      + '<button onclick="removeNoteImage(' + idx + ')" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;line-height:1;">&times;</button>'
      + '</div>';
  });
  gallery.innerHTML = html;
}

function removeNoteImage(idx) {
  _noteImages.splice(idx, 1);
  renderNoteImageGallery();
}
