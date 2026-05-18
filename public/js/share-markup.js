// =====================================================
// Public shared markup reviewer flow
// =====================================================

var _currentReportId = null;
var _investigations = [];
var _shareToken = decodeURIComponent((window.location.pathname.split('/').pop() || '').trim());
var _shareDetails = null;
var _shareIdentityAsked = false;
var _shareReviewerIdentity = { name: '', email: '' };

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(message) {
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = '<span>' + escHtml(message) + '</span>';
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3600);
}

async function loadInvestigations() {}
async function refreshReport() {}
function switchReportTab() {}
function renderMarkupAttachActions() {}
function renderMarkupShareActions() {}
function renderMarkupAttachActions() {}
function focusMarkupActivityPin() {}

var API = {
  async _publicFetch(url, opts) {
    var response = await fetch(url, opts);
    var payload = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      payload.error = payload.error || 'Request failed';
      payload.statusCode = response.status;
    }
    return payload;
  },
  async getMarkupArtifact() {
    var payload = await this._publicFetch('/api/public/markup-shares/' + encodeURIComponent(_shareToken));
    if (payload.error) {
      showShareUnavailable(payload.error, payload.statusCode);
      return payload;
    }
    _shareDetails = payload.share;
    updateShareStatusBanner();
    return payload.artifact;
  },
  async updateMarkupArtifact(artifactId, fields) {
    var body = {
      annotations: fields.annotations || [],
      page_meta: fields.page_meta || fields.pageMeta || {},
      reviewerName: _shareReviewerIdentity.name || '',
      reviewerEmail: _shareReviewerIdentity.email || ''
    };
    var payload = await this._publicFetch('/api/public/markup-shares/' + encodeURIComponent(_shareToken), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (payload.error) {
      showShareUnavailable(payload.error, payload.statusCode);
      return payload;
    }
    _shareDetails = payload.share;
    updateShareStatusBanner();
    return payload.artifact;
  }
};

function updateShareStatusBanner() {
  var banner = document.getElementById('shareStatusBanner');
  if (!banner || !_shareDetails) return;
  var saved = _shareDetails.lastReviewerSavedAt
    ? 'Last saved ' + new Date(_shareDetails.lastReviewerSavedAt).toLocaleString()
    : 'Add feedback, then save when you are ready.';
  banner.className = 'share-status-banner active';
  banner.textContent = saved;
}

function showShareUnavailable(message, statusCode) {
  var banner = document.getElementById('shareStatusBanner');
  if (banner) {
    banner.className = 'share-status-banner error';
    banner.textContent = statusCode === 410 ? 'This markup request is closed.' : (message || 'This markup request is unavailable.');
  }
  var saveBtn = document.getElementById('markupSaveBtn');
  if (saveBtn) saveBtn.disabled = true;
  var stage = document.getElementById('markupStage');
  if (stage) {
    stage.innerHTML = '<div style="padding:48px;text-align:center;color:#6B7280;background:#fff;border:1px solid #E5E7EB;border-radius:10px;">'
      + escHtml(statusCode === 410 ? 'This markup request is closed.' : 'This markup request could not be found.')
      + '</div>';
  }
}

function loadStoredShareIdentity() {
  try {
    var stored = JSON.parse(localStorage.getItem('auditAngelShareReviewer') || '{}');
    _shareReviewerIdentity.name = stored.name || '';
    _shareReviewerIdentity.email = stored.email || '';
    if (_shareReviewerIdentity.name || _shareReviewerIdentity.email) _shareIdentityAsked = true;
  } catch (err) {}
}

function showShareIdentityPanel() {
  var panel = document.getElementById('shareIdentityPanel');
  if (!panel) return;
  document.getElementById('shareReviewerName').value = _shareReviewerIdentity.name || '';
  document.getElementById('shareReviewerEmail').value = _shareReviewerIdentity.email || '';
  panel.classList.add('active');
}

function confirmShareIdentity(useValues) {
  if (useValues) {
    _shareReviewerIdentity.name = document.getElementById('shareReviewerName').value.trim();
    _shareReviewerIdentity.email = document.getElementById('shareReviewerEmail').value.trim();
    try {
      localStorage.setItem('auditAngelShareReviewer', JSON.stringify(_shareReviewerIdentity));
    } catch (err) {}
  }
  _shareIdentityAsked = true;
  document.getElementById('shareIdentityPanel').classList.remove('active');
  saveCurrentMarkup();
}

async function saveSharedMarkupFeedback() {
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
      showToast((updated && updated.error) || 'Could not save feedback');
      return;
    }
    _markup.artifact = updated;
    renderMarkupAnnotations();
    showToast('Feedback saved');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText || 'Save Feedback';
    }
  }
}

function saveCurrentMarkup() {
  if (!_shareIdentityAsked) {
    showShareIdentityPanel();
    return;
  }
  saveSharedMarkupFeedback();
}

document.addEventListener('DOMContentLoaded', function() {
  loadStoredShareIdentity();
  var saveBtn = document.getElementById('markupSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Save Feedback';
  openMarkupArtifact('shared');
});
