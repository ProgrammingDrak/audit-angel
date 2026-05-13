// =====================================================
// Export Engine — HTML report + JSON backup
// =====================================================

function exportInvHTML() {
  if (!_currentReportInv) return;
  var inv = _currentReportInv;
  var dateStr = new Date(inv.created).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  var pins = inv.pins || [];

  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>' + escHtml(inv.name) + ' — Investigation Report</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
    + '<style>'
    + ':root{--blue:#0075EB;--blue-light:#E8F2FE;--green:#00B373;--red:#DC2626;--amber:#D97706;--dark:#161E26;--text-sec:#6B7280;--border:#E5E7EB;--bg:#F5F5F5;}'
    + 'body{font-family:Poppins,-apple-system,BlinkMacSystemFont,sans-serif;max-width:860px;margin:0 auto;padding:40px 32px 60px;color:var(--dark);line-height:1.6;background:#F9FAFB;letter-spacing:-0.02em;}'
    + 'h1{font-size:24px;font-weight:700;margin-bottom:4px;}'
    + '.meta{font-size:13px;color:var(--text-sec);margin-bottom:24px;}'
    + '.summary{background:#fff;border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:32px;font-size:14px;line-height:1.7;white-space:pre-wrap;}'
    + '.summary-label{font-size:11px;font-weight:700;color:var(--text-sec);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;}'
    + '.toc{margin-bottom:32px;}'
    + '.toc-item{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:var(--dark);border-bottom:1px solid #F3F4F6;}'
    + '.toc-num{font-weight:700;color:var(--text-sec);width:24px;text-align:right;}'
    + '.toc-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}'
    + '.pin-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;page-break-inside:avoid;}'
    + '.pin-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;}'
    + '.pin-type{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:2px 8px;border-radius:4px;}'
    + '.pin-type.alert{background:rgba(220,38,38,0.08);color:var(--red);}'
    + '.pin-type.metric{background:rgba(217,119,6,0.08);color:var(--amber);}'
    + '.pin-type.note{background:rgba(0,117,235,0.08);color:var(--blue);}'
    + '.pin-type.deal{background:rgba(0,179,115,0.08);color:var(--green);}'
    + '.pin-type.screenshot{background:rgba(107,130,153,0.08);color:var(--text-sec);}'
    + '.pin-title{font-size:15px;font-weight:700;flex:1;}'
    + '.pin-time{font-size:10px;color:var(--text-sec);}'
    + '.pin-source{font-size:10px;color:var(--text-sec);}'
    + '.pin-note{font-size:13px;color:#374151;line-height:1.6;margin:8px 0;white-space:pre-wrap;}'
    + '.pin-img{max-width:100%;border-radius:8px;border:1px solid var(--border);margin:8px 0;}'
    + '.pin-img-caption{font-size:10px;color:var(--text-sec);margin-bottom:4px;}'
    + '.markup-card{display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:8px;padding:12px;background:#fff;margin:8px 0;}'
    + '.markup-icon{width:44px;height:44px;border-radius:8px;background:var(--blue-light);color:var(--blue);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;}'
    + '.markup-meta{flex:1;min-width:0}.markup-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.markup-sub{font-size:11px;color:var(--text-sec);margin-top:2px}.markup-link{font-size:12px;font-weight:700;color:var(--blue);text-decoration:none;}'
    + '.pin-data{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;}'
    + '.pin-data td{padding:4px 8px;border-bottom:1px solid #F3F4F6;}'
    + '.pin-data td:first-child{font-weight:600;color:var(--text-sec);white-space:nowrap;width:140px;}'
    + '.pin-children{margin-left:24px;border-left:2px solid #F3F4F6;padding-left:12px;}'
    + '.color-red{border-left:4px solid var(--red);}'
    + '.color-yellow{border-left:4px solid var(--amber);}'
    + '.color-green{border-left:4px solid var(--green);}'
    + '.color-blue{border-left:4px solid var(--blue);}'
    + '.footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-sec);text-align:center;}'
    + '@media print{body{padding:20px;background:#fff;}.pin-card{break-inside:avoid;}}'
    + '</style></head><body>';

  // Header
  html += '<h1>' + escHtml(inv.name) + '</h1>';
  html += '<div class="meta">' + pins.length + ' pins &middot; Created ' + dateStr;
  if (inv.completed_at) html += ' &middot; Completed ' + new Date(inv.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  html += '</div>';

  // Summary
  if (inv.summary) {
    html += '<div class="summary"><div class="summary-label">Summary of Findings</div>' + escHtml(inv.summary) + '</div>';
  }

  // Table of contents
  if (pins.length > 1) {
    html += '<div class="toc">';
    var colorMap = { red: '#DC2626', yellow: '#D97706', green: '#00B373', blue: '#0075EB' };
    _customPinColors.forEach(function(c) { colorMap[c.id] = c.hex; });
    pins.forEach(function(pin, idx) {
      var dotColor = pin.color && colorMap[pin.color] ? colorMap[pin.color] : '#E5E7EB';
      html += '<div class="toc-item"><span class="toc-num">' + (idx + 1) + '</span>'
        + '<span class="toc-dot" style="background:' + dotColor + ';"></span>'
        + escHtml(pin.title || 'Untitled') + '</div>';
    });
    html += '</div>';
  }

  // Pins
  pins.forEach(function(pin) {
    html += renderExportPin(pin);
  });

  // Footer
  html += '<div class="footer">Generated by The Audit Angel &middot; ' + new Date().toLocaleString() + '</div>';
  html += '</body></html>';

  downloadHTML(inv.name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').toLowerCase() + '-report.html', html);
}

function renderExportPin(pin) {
  var colorClass = pin.color ? ' color-' + pin.color : '';
  var typeClass = pin.type || 'note';
  var timeStr = pin.pinned_at ? new Date(pin.pinned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  var html = '<div class="pin-card' + colorClass + '">';
  html += '<div class="pin-header">';
  html += '<span class="pin-type ' + typeClass + '">' + typeClass.toUpperCase() + '</span>';
  if (pin.source) html += '<span class="pin-source">' + escHtml(pin.source) + '</span>';
  html += '<span class="pin-title">' + escHtml(pin.title || 'Untitled') + '</span>';
  html += '<span class="pin-time">' + timeStr + '</span>';
  html += '</div>';

  // Images
  if ((pin.type || '') === 'markup') {
    var artifactId = pin.data && pin.data.artifactId;
    var annCount = pin.data && pin.data.annotationCount ? pin.data.annotationCount : 0;
    var sourceName = (pin.data && pin.data.sourceName) || pin.source || pin.title || 'Markup Artifact';
    html += '<div class="markup-card"><div class="markup-icon">&#9998;</div><div class="markup-meta">'
      + '<div class="markup-name">' + escHtml(sourceName) + '</div>'
      + '<div class="markup-sub">' + annCount + ' annotation' + (annCount === 1 ? '' : 's') + ' &middot; Annotated review artifact</div>'
      + '</div>';
    if (artifactId) html += '<a class="markup-link" href="' + window.location.origin + API.exportMarkupArtifactUrl(artifactId) + '">Open annotated export</a>';
    html += '</div>';
  }

  // Images
  if ((pin.type || '') !== 'markup' && pin.images && pin.images.length > 0) {
    pin.images.forEach(function(img) {
      if (img.caption) html += '<div class="pin-img-caption">' + escHtml(img.caption) + '</div>';
      html += '<img class="pin-img" src="' + img.data_url + '">';
      if (img.link) html += '<div style="font-size:10px;margin-bottom:4px;"><a href="' + escHtml(img.link) + '" target="_blank" style="color:#0075EB;">' + escHtml(img.link) + '</a></div>';
    });
  }

  // Note (with markdown)
  if (pin.note) html += '<div class="pin-note">' + renderMarkdown(pin.note) + '</div>';

  // Data
  var data = pin.data || {};
  var keys = Object.keys(data);
  if ((pin.type || '') !== 'markup' && keys.length > 0) {
    html += '<table class="pin-data">';
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
    pin.children.forEach(function(child) { html += renderExportPin(child); });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function downloadHTML(filename, content) {
  var blob = new Blob([content], { type: 'text/html' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// JSON export/import
async function exportAllJSON() {
  closeMenu('importExportMenu');
  var data = await API.exportJSON();
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'audit-angel-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported ' + data.investigations.length + ' investigations');
}

async function handleJSONImport(input) {
  closeMenu('importExportMenu');
  if (!input.files[0]) return;
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var data = JSON.parse(e.target.result);
      // Handle both formats: raw array (from localStorage export) or {investigations: [...]} (from our export)
      if (Array.isArray(data)) {
        data = { investigations: data };
      }
      // Handle localStorage format: convert camelCase to snake_case fields
      var result;
      if (data.investigations && data.investigations.length && data.investigations[0].completedAt !== undefined) {
        result = await API.importLocalStorage(data.investigations);
      } else {
        result = await API.importJSON(data);
      }
      await loadInvestigations();
      showToast('Imported ' + result.imported + ' investigations (' + result.skipped + ' skipped)');
    } catch (err) {
      showToast('Import failed: ' + err.message);
    }
  };
  reader.readAsText(input.files[0]);
  input.value = '';
}

// --- AI-Readable Export (Markdown) ---
function exportInvAI() {
  if (!_currentReportInv) return;
  var inv = _currentReportInv;
  var imageMode = 'none';
  document.querySelectorAll('input[name="aiExportImages"]').forEach(function(r) { if (r.checked) imageMode = r.value; });

  var md = '# ' + (inv.name || 'Investigation') + '\n';
  md += 'Created: ' + (inv.created || '') + ' | Pins: ' + (inv.pins || []).length + ' | Status: ' + (inv.completed_at ? 'Closed ' + inv.completed_at : 'Open') + '\n\n';

  if (inv.summary) md += '## Summary\n' + inv.summary.trim() + '\n\n';

  var summaryPins = (inv.pins || []).filter(function(p) { return p.in_summary; });
  if (summaryPins.length) {
    md += '## Key Findings\n';
    summaryPins.forEach(function(pin, idx) {
      md += _formatPinAI(pin, idx + 1, imageMode, '###');
    });
    md += '\n';
  }

  md += '## All Data Points\n';
  (inv.pins || []).forEach(function(pin, idx) {
    md += _formatPinAI(pin, idx + 1, imageMode, '###');
    if (pin.children && pin.children.length) {
      pin.children.forEach(function(child, ci) {
        md += _formatPinAI(child, (idx + 1) + '.' + (ci + 1), imageMode, '####');
      });
    }
  });

  md += '---\nGenerated: ' + new Date().toISOString() + ' | The Audit Angel\n';

  var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (inv.name || 'investigation').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').toLowerCase() + '-ai-export.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

function _formatPinAI(pin, num, imageMode, headingLevel) {
  var md = '';
  md += headingLevel + ' PIN ' + num + ': [' + (pin.type || 'note').toUpperCase() + '] ' + (pin.title || '') + '\n';
  if (pin.source) md += '- Source: ' + pin.source + '\n';
  if (pin.color) md += '- Color: ' + getColorLabel(pin.color) + '\n';
  if (pin.pinned_at) md += '- Date: ' + pin.pinned_at + '\n';
  if (pin.in_summary) md += '- Key Finding: yes\n';
  if (pin.note) md += '- Note: ' + pin.note.replace(/\n/g, ' ') + '\n';
  if ((pin.type || '') === 'markup') {
    var artifact = pin.data || {};
    md += '- Markup artifact: ' + (artifact.sourceName || pin.source || pin.title || '') + '\n';
    md += '- Annotation count: ' + (artifact.annotationCount || 0) + '\n\n';
    return md;
  }

  var data = pin.data || {};
  var entries = [];
  Object.keys(data).forEach(function(k) {
    if (data[k] !== null && data[k] !== undefined) {
      var val = data[k];
      if (typeof val === 'object') { try { val = JSON.stringify(val); } catch(e) { val = String(val); } }
      entries.push(k + ': ' + val);
    }
  });
  if (entries.length) md += '- Data: ' + entries.join(', ') + '\n';

  var images = pin.images || [];
  if (images.length) {
    md += '- Images (' + images.length + '):\n';
    images.forEach(function(img, i) {
      var parts = ['Image ' + (i + 1)];
      if (img.caption) parts.push('Caption: ' + img.caption);
      if (img.link) parts.push('Source: ' + img.link);
      md += '  - ' + parts.join(' | ') + '\n';
      if (imageMode === 'full' && img.data_url) {
        md += '  - ![Image ' + (i + 1) + '](' + img.data_url + ')\n';
      } else if (imageMode === 'compressed' && img.data_url) {
        md += _compressImageForAI(img.data_url);
      }
    });
  }
  md += '\n';
  return md;
}

function _compressImageForAI(dataUrl) {
  // For AI export, create a tiny thumbnail reference
  try {
    var canvas = document.createElement('canvas');
    var img = new Image();
    img.src = dataUrl;
    canvas.width = 120;
    canvas.height = Math.round(120 * (img.height / img.width)) || 80;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    var thumb = canvas.toDataURL('image/jpeg', 0.3);
    return '  - ![thumb](' + thumb + ')\n';
  } catch(e) {
    return '';
  }
}

async function importFromLocalStorage() {
  closeMenu('importExportMenu');
  var raw = localStorage.getItem('phcc_investigations');
  if (!raw) {
    alert('No investigation data found in THIS browser tab\'s localStorage.\n\n'
      + 'localStorage is per-origin — if your investigations were created in the old Audit Angel (a different URL), they won\'t appear here.\n\n'
      + 'To migrate:\n'
      + '1. Open the OLD Audit Angel in your browser\n'
      + '2. Open the browser console (Cmd+Option+J)\n'
      + '3. Paste this command:\n\n'
      + 'var d=localStorage.getItem("phcc_investigations");if(d){var b=new Blob([d],{type:"application/json"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="investigations-export.json";a.click();}\n\n'
      + '4. That downloads a JSON file\n'
      + '5. Come back here and use Import / Export > Import from JSON');
    return;
  }
  try {
    var data = JSON.parse(raw);
    var result = await API.importLocalStorage(data);
    await loadInvestigations();
    showToast('Migrated ' + result.imported + ' investigations from browser');
  } catch (err) {
    showToast('Migration failed: ' + err.message);
  }
}
