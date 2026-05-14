// =====================================================
// API Client — wraps all server calls
// =====================================================
var API = {
  async _fetch(url, opts) {
    var r = await fetch(url, opts);
    if (r.status === 401) { window.location.href = '/login'; return null; }
    return r.json();
  },
  async getInvestigations() {
    return this._fetch('/api/investigations');
  },
  async getInvestigation(id) {
    return this._fetch('/api/investigations/' + id);
  },
  async createInvestigation(name) {
    return this._fetch('/api/investigations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  },
  async updateInvestigation(id, fields) {
    return this._fetch('/api/investigations/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
  },
  async deleteInvestigation(id) {
    return this._fetch('/api/investigations/' + id, { method: 'DELETE' });
  },
  async completeInvestigation(id) {
    return this._fetch('/api/investigations/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed_at: new Date().toISOString() }) });
  },
  async reopenInvestigation(id) {
    return this._fetch('/api/investigations/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed_at: null }) });
  },
  async addPin(invId, pin) {
    return this._fetch('/api/investigations/' + invId + '/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pin) });
  },
  async createMarkupArtifact(invId, artifact) {
    return this._fetch('/api/investigations/' + invId + '/markup-artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(artifact) });
  },
  async getStandaloneMarkupArtifacts() {
    return this._fetch('/api/markup-artifacts?standalone=1');
  },
  async createStandaloneMarkupArtifact(artifact) {
    return this._fetch('/api/markup-artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(artifact) });
  },
  async getMarkupArtifact(artifactId) {
    return this._fetch('/api/markup-artifacts/' + artifactId);
  },
  async attachMarkupArtifact(artifactId, fields) {
    return this._fetch('/api/markup-artifacts/' + artifactId + '/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields || {}) });
  },
  async updateMarkupArtifact(artifactId, fields) {
    return this._fetch('/api/markup-artifacts/' + artifactId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
  },
  exportMarkupArtifactUrl(artifactId) {
    return '/api/markup-artifacts/' + artifactId + '/export';
  },
  async updatePin(pinId, fields) {
    return this._fetch('/api/pins/' + pinId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
  },
  async deletePin(pinId) {
    return this._fetch('/api/pins/' + pinId, { method: 'DELETE' });
  },
  async movePin(pinId, targetInvId) {
    return this._fetch('/api/pins/' + pinId + '/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toInvestigationId: targetInvId }) });
  },
  async copyPin(pinId, targetInvId) {
    return this._fetch('/api/pins/' + pinId + '/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toInvestigationId: targetInvId }) });
  },
  async reorderPins(invId, pinIds) {
    var items = pinIds.map(function(id, i) { return { pin_id: id, sort_order: i }; });
    return this._fetch('/api/investigations/' + invId + '/pins/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
  },
  async addImages(pinId, images) {
    return this._fetch('/api/pins/' + pinId + '/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(images) });
  },
  async deleteImage(imageId) {
    return this._fetch('/api/images/' + imageId, { method: 'DELETE' });
  },
  async exportJSON() {
    return this._fetch('/api/export/json');
  },
  async importJSON(data) {
    return this._fetch('/api/import/json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  },
  async importLocalStorage(data) {
    return this._fetch('/api/migrate/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  }
};
